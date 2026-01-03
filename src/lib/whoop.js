import dotenv from 'dotenv';
import { updateUserTokens } from './supabase.js';

dotenv.config();

const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer';
const WHOOP_AUTH_BASE = 'https://api.prod.whoop.com/oauth/oauth2';

// Scopes necessari
const SCOPES = [
  'read:recovery',
  'read:cycles', 
  'read:workout',
  'read:sleep',
  'read:profile',
  'read:body_measurement'
].join(' ');

// Genera URL per OAuth
export function getAuthUrl() {
  const params = new URLSearchParams({
    client_id: process.env.WHOOP_CLIENT_ID,
    redirect_uri: process.env.WHOOP_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    state: 'whoop_auth' // Puoi usare un valore random per sicurezza
  });
  
  return `${WHOOP_AUTH_BASE}/auth?${params.toString()}`;
}

// Scambia code per tokens
export async function exchangeCodeForTokens(code) {
  const response = await fetch(`${WHOOP_AUTH_BASE}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.WHOOP_CLIENT_ID,
      client_secret: process.env.WHOOP_CLIENT_SECRET,
      redirect_uri: process.env.WHOOP_REDIRECT_URI,
      code: code
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }
  
  return response.json();
}

// Refresh token
export async function refreshAccessToken(refreshToken) {
  const response = await fetch(`${WHOOP_AUTH_BASE}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.WHOOP_CLIENT_ID,
      client_secret: process.env.WHOOP_CLIENT_SECRET,
      refresh_token: refreshToken
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }
  
  return response.json();
}

// Helper per chiamate API autenticate
async function whoopFetch(endpoint, accessToken, options = {}) {
  const response = await fetch(`${WHOOP_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Whoop API error: ${response.status} - ${error}`);
  }
  
  return response.json();
}

// Ottieni profilo utente
export async function getUserProfile(accessToken) {
  return whoopFetch('/v2/user/profile/basic', accessToken);
}

// Ottieni misure corpo (peso, altezza, etc)
export async function getBodyMeasurements(accessToken) {
  return whoopFetch('/v2/user/measurement/body', accessToken);
}

// Helper per ottenere data inizio (48h fa per sicurezza timezone)
function getStartDate() {
  const start = new Date();
  start.setHours(start.getHours() - 48);
  return start.toISOString();
}

// Helper per ottenere data di oggi in formato YYYY-MM-DD (timezone Italia)
function getTodayDateString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
}

// Ottieni workout di oggi
export async function getTodayWorkouts(accessToken) {
  const params = new URLSearchParams({
    start: getStartDate(),
    limit: '25'
  });
  
  const response = await whoopFetch(`/v2/activity/workout?${params}`, accessToken);
  
  // Filtra solo workout di oggi (timezone Italia)
  const todayStr = getTodayDateString();
  const todayWorkouts = response.records?.filter(w => {
    const workoutDate = new Date(w.start).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
    return workoutDate === todayStr;
  }) || [];
  
  return { records: todayWorkouts };
}

// Ottieni recovery più recente
export async function getTodayRecovery(accessToken) {
  const params = new URLSearchParams({
    start: getStartDate(),
    limit: '5'
  });
  
  const response = await whoopFetch(`/v2/recovery?${params}`, accessToken);
  // Prendi la più recente
  return response.records?.[0] || null;
}

// Ottieni sleep più recente
export async function getTodaySleep(accessToken) {
  const params = new URLSearchParams({
    start: getStartDate(),
    limit: '5'
  });
  
  const response = await whoopFetch(`/v2/activity/sleep?${params}`, accessToken);
  // Prendi il più recente
  return response.records?.[0] || null;
}

// Ottieni cycle (strain giornaliero) più recente
export async function getTodayCycle(accessToken) {
  const params = new URLSearchParams({
    start: getStartDate(),
    limit: '5'
  });
  
  const response = await whoopFetch(`/v2/cycle?${params}`, accessToken);
  // Prendi il più recente
  return response.records?.[0] || null;
}

// Funzione completa: ottieni tutti i dati di oggi
export async function getTodayData(accessToken) {
  try {
    const [workouts, recovery, sleep, cycle] = await Promise.all([
      getTodayWorkouts(accessToken),
      getTodayRecovery(accessToken),
      getTodaySleep(accessToken),
      getTodayCycle(accessToken)
    ]);
    
    const hasWorkout = workouts.records && workouts.records.length > 0;
    const workoutData = hasWorkout ? workouts.records[0] : null;
    
    return {
      hasWorkout,
      workout: workoutData ? {
        type: workoutData.sport_name,
        strain: workoutData.score?.strain,
        calories: workoutData.score?.kilojoule ? Math.round(workoutData.score.kilojoule / 4.184) : null,
        duration_minutes: workoutData.start && workoutData.end 
          ? Math.round((new Date(workoutData.end) - new Date(workoutData.start)) / 60000)
          : null
      } : null,
      recovery: recovery?.score ? {
        score: recovery.score.recovery_score,
        hrv: recovery.score.hrv_rmssd_milli,
        resting_hr: recovery.score.resting_heart_rate
      } : null,
      sleep: sleep?.score ? {
        performance: sleep.score.sleep_performance_percentage,
        efficiency: sleep.score.sleep_efficiency_percentage,
        duration_hours: sleep.score.stage_summary?.total_in_bed_time_milli 
          ? (sleep.score.stage_summary.total_in_bed_time_milli / 3600000).toFixed(1)
          : null
      } : null,
      strain: cycle?.score?.strain || null
    };
  } catch (error) {
    console.error('Error fetching Whoop data:', error);
    throw error;
  }
}

// Verifica se token è scaduto e refreshalo se necessario
export async function ensureValidToken(user) {
  if (!user.whoop_access_token) {
    return null;
  }
  
  const expiresAt = new Date(user.whoop_token_expires_at);
  const now = new Date();
  
  // Se scade tra meno di 5 minuti, refresh
  if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
    console.log('Token expiring soon, refreshing...');
    
    try {
      const tokens = await refreshAccessToken(user.whoop_refresh_token);
      await updateUserTokens(user.id, tokens);
      return tokens.access_token;
    } catch (error) {
      console.error('Failed to refresh token:', error);
      return null;
    }
  }
  
  return user.whoop_access_token;
}
