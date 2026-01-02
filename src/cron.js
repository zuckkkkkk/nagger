import cron from 'node-cron';
import dotenv from 'dotenv';
import {
  getAllUsers,
  getTodayActivity,
  upsertDailyActivity,
  getTodayReminders,
  logReminder,
  getReminderSettings,
  getStats,
  updateStats
} from './lib/supabase.js';
import {
  ensureValidToken,
  getTodayData
} from './lib/whoop.js';
import {
  sendEmail,
  sendSMS,
  sendSuccessEmail
} from './lib/notifications.js';

dotenv.config();

// ============================================
// LOGICA PRINCIPALE DI NAGGING
// ============================================

async function checkAndNag() {
  console.log(`\n⏰ [${new Date().toLocaleTimeString('it-IT')}] Running nag check...`);
  
  const users = await getAllUsers();
  
  for (const user of users) {
    try {
      await processUser(user);
    } catch (error) {
      console.error(`Error processing user ${user.email}:`, error);
    }
  }
}

async function processUser(user) {
  // Controlla orario (solo tra start_hour e end_hour)
  const settings = await getReminderSettings(user.id);
  const currentHour = new Date().getHours();
  
  if (!settings.enabled) {
    console.log(`  ⏸️ ${user.email}: Reminders disabled`);
    return;
  }
  
  if (currentHour < settings.start_hour || currentHour > settings.end_hour) {
    console.log(`  😴 ${user.email}: Outside reminder hours (${settings.start_hour}-${settings.end_hour})`);
    return;
  }
  
  // Ottieni dati Whoop
  const accessToken = await ensureValidToken(user);
  let whoopData = null;
  
  if (accessToken) {
    try {
      whoopData = await getTodayData(accessToken);
      console.log(`  📊 ${user.email}: Whoop data fetched - hasWorkout: ${whoopData.hasWorkout}`);
    } catch (error) {
      console.error(`  ❌ ${user.email}: Failed to fetch Whoop data:`, error.message);
    }
  } else {
    console.log(`  ⚠️ ${user.email}: No valid Whoop token`);
  }
  
  // Controlla attività di oggi
  const todayActivity = await getTodayActivity(user.id);
  const workoutDone = whoopData?.hasWorkout || todayActivity?.workout_done;
  
  // Aggiorna daily_activity con dati Whoop
  if (whoopData) {
    const today = new Date().toISOString().split('T')[0];
    await upsertDailyActivity(user.id, today, {
      workout_done: whoopData.hasWorkout,
      workout_strain: whoopData.workout?.strain,
      workout_calories: whoopData.workout?.calories,
      workout_type: whoopData.workout?.type,
      recovery_score: whoopData.recovery?.score,
      sleep_performance: whoopData.sleep?.performance
    });
  }
  
  // Se workout fatto, manda congratulazioni (una volta sola)
  if (workoutDone) {
    const todayReminders = await getTodayReminders(user.id);
    const alreadyCongratulated = todayReminders.some(r => r.type === 'success');
    
    if (!alreadyCongratulated && whoopData?.workout) {
      await sendSuccessEmail(user.email, whoopData.workout);
      await logReminder(user.id, 'success', 'Workout completed');
      
      // Aggiorna streak
      await updateStreak(user.id, true);
    }
    
    console.log(`  ✅ ${user.email}: Workout done today!`);
    return;
  }
  
  // Se non ha fatto workout, calcola escalation
  await handleNagging(user, settings);
}

async function handleNagging(user, settings) {
  const todayReminders = await getTodayReminders(user.id);
  const now = new Date();
  const dayStart = new Date();
  dayStart.setHours(settings.start_hour, 0, 0, 0);
  
  const hoursSinceStart = (now - dayStart) / (1000 * 60 * 60);
  
  // Conta reminder già inviati oggi
  const emailsSent = todayReminders.filter(r => r.type.startsWith('email')).length;
  const smsSent = todayReminders.filter(r => r.type.startsWith('sms')).length;
  
  // Trova ultimo reminder per tipo
  const lastEmail = todayReminders
    .filter(r => r.type.startsWith('email'))
    .sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at))[0];
  
  const lastSMS = todayReminders
    .filter(r => r.type.startsWith('sms'))
    .sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at))[0];
  
  const hoursSinceLastEmail = lastEmail 
    ? (now - new Date(lastEmail.sent_at)) / (1000 * 60 * 60)
    : Infinity;
  
  const hoursSinceLastSMS = lastSMS
    ? (now - new Date(lastSMS.sent_at)) / (1000 * 60 * 60)
    : Infinity;
  
  const isAggressive = hoursSinceStart >= settings.aggressive_after_hours;
  
  console.log(`  📝 ${user.email}: Hours since start: ${hoursSinceStart.toFixed(1)}, emails: ${emailsSent}, SMS: ${smsSent}`);
  
  // Logica email
  if (hoursSinceLastEmail >= settings.email_interval_hours) {
    let emailType;
    if (emailsSent === 0) {
      emailType = 'email_gentle';
    } else if (isAggressive) {
      emailType = 'email_aggressive';
    } else {
      emailType = 'email_reminder';
    }
    
    try {
      await sendEmail(user.email, emailType);
      await logReminder(user.id, emailType, `Sent ${emailType}`);
      console.log(`  📧 ${user.email}: Sent ${emailType}`);
    } catch (error) {
      console.error(`  ❌ Failed to send email:`, error.message);
    }
  }
  
  // Logica SMS (solo dopo primo email e se passato abbastanza tempo)
  if (emailsSent > 0 && hoursSinceLastSMS >= settings.sms_interval_hours && user.phone) {
    let smsType;
    if (smsSent === 0) {
      smsType = 'sms_gentle';
    } else if (isAggressive) {
      smsType = 'sms_aggressive';
    } else {
      smsType = 'sms_reminder';
    }
    
    try {
      await sendSMS(user.phone, smsType);
      await logReminder(user.id, smsType, `Sent ${smsType}`);
      console.log(`  📱 ${user.email}: Sent ${smsType}`);
    } catch (error) {
      console.error(`  ❌ Failed to send SMS:`, error.message);
    }
  }
}

async function updateStreak(userId, workoutDone) {
  const stats = await getStats(userId);
  if (!stats) return;
  
  if (workoutDone) {
    const newStreak = stats.current_streak + 1;
    const newLongest = Math.max(stats.longest_streak, newStreak);
    
    await updateStats(userId, {
      current_streak: newStreak,
      longest_streak: newLongest,
      total_workouts: stats.total_workouts + 1
    });
  } else {
    await updateStats(userId, {
      current_streak: 0
    });
  }
}

// Email di vergogna serale per chi non ha fatto niente
async function sendEveningShame() {
  console.log(`\n🌙 [${new Date().toLocaleTimeString('it-IT')}] Sending evening shame emails...`);
  
  const users = await getAllUsers();
  
  for (const user of users) {
    try {
      const settings = await getReminderSettings(user.id);
      if (!settings.enabled) continue;
      
      const todayActivity = await getTodayActivity(user.id);
      
      if (!todayActivity?.workout_done) {
        await sendEmail(user.email, 'email_shame');
        await logReminder(user.id, 'email_shame', 'Evening shame');
        
        // Reset streak
        await updateStreak(user.id, false);
        
        console.log(`  😔 ${user.email}: Shame email sent`);
      }
    } catch (error) {
      console.error(`Error sending shame to ${user.email}:`, error);
    }
  }
}

// ============================================
// CRON JOBS
// ============================================

export function startCronJobs() {
  console.log('🕐 Starting cron jobs...');
  
  // Ogni ora dalle 9 alle 21
  cron.schedule('0 9-21 * * *', async () => {
    await checkAndNag();
  }, {
    timezone: 'Europe/Rome'
  });
  
  // Email serale di vergogna alle 21:30
  cron.schedule('30 21 * * *', async () => {
    await sendEveningShame();
  }, {
    timezone: 'Europe/Rome'
  });
  
  // Check ogni 30 minuti per essere più aggressivo
  cron.schedule('30 9-21 * * *', async () => {
    await checkAndNag();
  }, {
    timezone: 'Europe/Rome'
  });
  
  console.log('✅ Cron jobs scheduled:');
  console.log('   - Check & Nag: every hour 9-21 (Rome)');
  console.log('   - Check & Nag: every :30 9-21 (Rome)');
  console.log('   - Evening Shame: 21:30 (Rome)');
  
  // Esegui subito un check
  console.log('\n🚀 Running initial check...');
  checkAndNag();
}

// Export per test manuali
export { checkAndNag, sendEveningShame };
