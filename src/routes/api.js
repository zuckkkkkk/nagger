import { Router } from 'express';
import dotenv from 'dotenv';
import {
  getUser,
  getTodayActivity,
  upsertDailyActivity,
  getStats,
  getWeightHistory,
  logWeight,
  getActivityHistory,
  getTodayReminders,
  getReminderSettings,
  supabase
} from '../lib/supabase.js';
import { ensureValidToken, getTodayData } from '../lib/whoop.js';
import { checkAndNag } from '../cron.js';

dotenv.config();

const router = Router();

// Middleware semplice (per ora single user)
async function getMainUser(req, res, next) {
  try {
    const user = await getUser(process.env.YOUR_EMAIL);
    if (!user) {
      return res.status(404).json({ 
        error: `Utente ${process.env.YOUR_EMAIL} non trovato nel database. Hai eseguito setup.sql?` 
      });
    }
    req.user = user;
    next();
  } catch (error) {
    console.error('Error getting user:', error);
    res.status(500).json({ 
      error: `Database error: ${error.message}. Controlla SUPABASE_URL e SUPABASE_SERVICE_KEY` 
    });
  }
}

router.use(getMainUser);

// Dashboard principale - tutti i dati
router.get('/dashboard', async (req, res) => {
  try {
    const user = req.user;
    
    // Dati Whoop in tempo reale
    let whoopData = null;
    const accessToken = await ensureValidToken(user);
    if (accessToken) {
      try {
        whoopData = await getTodayData(accessToken);
      } catch (e) {
        console.error('Whoop fetch error:', e.message);
      }
    }
    
    // Dati dal database
    const [todayActivity, stats, weightHistory, activityHistory, todayReminders, settings] = await Promise.all([
      getTodayActivity(user.id),
      getStats(user.id),
      getWeightHistory(user.id, 90),
      getActivityHistory(user.id, 30),
      getTodayReminders(user.id),
      getReminderSettings(user.id)
    ]);
    
    // Calcola peso attuale e obiettivo
    const currentWeight = weightHistory.length > 0 
      ? weightHistory[weightHistory.length - 1].weight_kg 
      : 93;
    const startWeight = 93;
    const goalWeight = 85;
    const weightLost = startWeight - currentWeight;
    const weightToGo = currentWeight - goalWeight;
    
    res.json({
      user: {
        email: user.email,
        whoop_connected: !!user.whoop_access_token
      },
      today: {
        workout_done: whoopData?.hasWorkout || todayActivity?.workout_done || false,
        workout: whoopData?.workout || null,
        recovery: whoopData?.recovery || null,
        sleep: whoopData?.sleep || null,
        strain: whoopData?.strain || null,
        meals_ok: todayActivity?.meals_ok ?? true,
        alcohol: todayActivity?.alcohol ?? false,
        reminders_sent: todayReminders.length
      },
      stats: {
        current_streak: stats?.current_streak || 0,
        longest_streak: stats?.longest_streak || 0,
        total_workouts: stats?.total_workouts || 0
      },
      weight: {
        current: currentWeight,
        start: startWeight,
        goal: goalWeight,
        lost: weightLost,
        to_go: weightToGo,
        history: weightHistory
      },
      activity_history: activityHistory,
      settings: settings
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Log peso
router.post('/weight', async (req, res) => {
  try {
    const { weight } = req.body;
    if (!weight || weight < 40 || weight > 200) {
      return res.status(400).json({ error: 'Invalid weight' });
    }
    
    const result = await logWeight(req.user.id, weight);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Log attività manuale
router.post('/activity', async (req, res) => {
  try {
    const { workout_done, meals_ok, alcohol, notes } = req.body;
    const today = new Date().toISOString().split('T')[0];
    
    const result = await upsertDailyActivity(req.user.id, today, {
      workout_done,
      meals_ok,
      alcohol,
      notes
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Aggiorna settings
router.put('/settings', async (req, res) => {
  try {
    const { enabled, start_hour, end_hour, email_interval_hours, sms_interval_hours } = req.body;
    
    const { data, error } = await supabase
      .from('reminder_settings')
      .update({
        enabled,
        start_hour,
        end_hour,
        email_interval_hours,
        sms_interval_hours
      })
      .eq('user_id', req.user.id)
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Forza check manuale (per debug)
router.post('/force-check', async (req, res) => {
  try {
    await checkAndNag();
    res.json({ success: true, message: 'Check executed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Storico reminder
router.get('/reminders', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('reminder_logs')
      .select('*')
      .eq('user_id', req.user.id)
      .order('sent_at', { ascending: false })
      .limit(50);
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sync manuale Whoop
router.post('/sync-whoop', async (req, res) => {
  try {
    const accessToken = await ensureValidToken(req.user);
    if (!accessToken) {
      return res.status(401).json({ error: 'Whoop not connected' });
    }
    
    const whoopData = await getTodayData(accessToken);
    const today = new Date().toISOString().split('T')[0];
    
    await upsertDailyActivity(req.user.id, today, {
      workout_done: whoopData.hasWorkout,
      workout_strain: whoopData.workout?.strain,
      workout_calories: whoopData.workout?.calories,
      workout_type: whoopData.workout?.type,
      recovery_score: whoopData.recovery?.score,
      sleep_performance: whoopData.sleep?.performance
    });
    
    res.json({ success: true, data: whoopData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
