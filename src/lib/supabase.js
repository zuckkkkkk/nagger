import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Helper functions
export async function getUser(email) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();
  
  // Se utente non trovato, ritorna null invece di throw
  if (error && error.code === 'PGRST116') {
    return null;
  }
  if (error) throw error;
  return data;
}

export async function getUserById(id) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .single();
  
  if (error) throw error;
  return data;
}

export async function getAllUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('*');
  
  if (error) throw error;
  return data;
}

export async function updateUserTokens(userId, tokens) {
  const { error } = await supabase
    .from('users')
    .update({
      whoop_access_token: tokens.access_token,
      whoop_refresh_token: tokens.refresh_token,
      whoop_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    })
    .eq('id', userId);
  
  if (error) throw error;
}

export async function getTodayActivity(userId) {
  const today = new Date().toISOString().split('T')[0];
  
  const { data, error } = await supabase
    .from('daily_activity')
    .select('*')
    .eq('user_id', userId)
    .eq('date', today)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
  return data;
}

export async function upsertDailyActivity(userId, date, activity) {
  const { data, error } = await supabase
    .from('daily_activity')
    .upsert({
      user_id: userId,
      date: date,
      ...activity
    }, { onConflict: 'user_id,date' })
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function getLastReminder(userId, type) {
  const { data, error } = await supabase
    .from('reminder_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('type', type)
    .order('sent_at', { ascending: false })
    .limit(1)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function getTodayReminders(userId) {
  const today = new Date().toISOString().split('T')[0];
  
  const { data, error } = await supabase
    .from('reminder_logs')
    .select('*')
    .eq('user_id', userId)
    .gte('sent_at', today);
  
  if (error) throw error;
  return data || [];
}

export async function logReminder(userId, type, message) {
  const { error } = await supabase
    .from('reminder_logs')
    .insert({
      user_id: userId,
      type: type,
      message: message
    });
  
  if (error) throw error;
}

export async function getReminderSettings(userId) {
  const { data, error } = await supabase
    .from('reminder_settings')
    .select('*')
    .eq('user_id', userId)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error;
  return data || {
    enabled: true,
    start_hour: 9,
    end_hour: 21,
    email_interval_hours: 3,
    sms_interval_hours: 4,
    aggressive_after_hours: 6
  };
}

export async function getStats(userId) {
  const { data, error } = await supabase
    .from('stats')
    .select('*')
    .eq('user_id', userId)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function updateStats(userId, updates) {
  const { error } = await supabase
    .from('stats')
    .update(updates)
    .eq('user_id', userId);
  
  if (error) throw error;
}

export async function getWeightHistory(userId, days = 90) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const { data, error } = await supabase
    .from('weight_logs')
    .select('*')
    .eq('user_id', userId)
    .gte('logged_at', startDate.toISOString().split('T')[0])
    .order('logged_at', { ascending: true });
  
  if (error) throw error;
  return data || [];
}

export async function logWeight(userId, weight) {
  const today = new Date().toISOString().split('T')[0];
  
  const { data, error } = await supabase
    .from('weight_logs')
    .upsert({
      user_id: userId,
      weight_kg: weight,
      logged_at: today
    }, { onConflict: 'user_id,logged_at' })
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function getActivityHistory(userId, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const { data, error } = await supabase
    .from('daily_activity')
    .select('*')
    .eq('user_id', userId)
    .gte('date', startDate.toISOString().split('T')[0])
    .order('date', { ascending: false });
  
  if (error) throw error;
  return data || [];
}
