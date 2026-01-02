import { Resend } from 'resend';
import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

// Inizializza Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// Inizializza Twilio (solo se configurato e non usiamo WhatsApp)
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && !process.env.USE_WHATSAPP) {
  twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
}

// ============================================
// MESSAGGI - Escalation di aggressività
// ============================================

const MESSAGES = {
  email_gentle: {
    subject: '🏃 Ehi Mattia, ti sei mosso oggi?',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Ciao Mattia!</h2>
        <p>Non ho visto nessun workout sul tuo Whoop oggi.</p>
        <p>Ricorda il piano: bici, cyclette, o anche solo una camminata.</p>
        <p>Anche 15 minuti contano. Vai! 💪</p>
        <hr style="margin: 20px 0;">
        <p style="color: #666; font-size: 12px;">Il tuo nagger personale</p>
      </div>
    `
  },
  
  email_reminder: {
    subject: '⚠️ Mattia, ancora niente attività...',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #e67e22;">Sono passate ore.</h2>
        <p>Il Whoop non ha registrato nessun workout.</p>
        <p>Non ti sto chiedendo di correre una maratona.</p>
        <p><strong>15-20 minuti di cyclette.</strong> Basta questo.</p>
        <p>Pensa a come ti sentirai stasera se non fai niente.</p>
        <p>Pensa a Pasqua, a quei 85 kg.</p>
        <p>Muoviti. Ora.</p>
      </div>
    `
  },
  
  email_aggressive: {
    subject: '🔴 MATTIA. SVEGLIA.',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background: #fee; padding: 20px;">
        <h1 style="color: #c0392b;">BASTA SCUSE.</h1>
        <p style="font-size: 18px;">Un altro giorno buttato?</p>
        <p>93 kg. Stanchezza. Padre e nonno diabetici.</p>
        <p>Hai detto "ci sto un botto". Dimostralo.</p>
        <p><strong>ALZA IL CULO E FAI QUALCOSA.</strong></p>
        <p>Anche 10 minuti. Ma ADESSO.</p>
        <p style="color: #c0392b; font-size: 24px;">🚴 VAI. 🚴</p>
      </div>
    `
  },
  
  email_shame: {
    subject: '📊 Report giornaliero: giornata persa',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #c0392b;">Zero attività oggi.</h2>
        <p>Lo streak si è interrotto.</p>
        <p>Domani è un altro giorno, ma oggi hai scelto di non fare niente.</p>
        <p>Questa email la riceverai ogni sera che non ti muovi.</p>
        <p>Vuoi continuare a riceverla?</p>
        <hr>
        <p style="color: #666;">Domani svegliati e pedala.</p>
      </div>
    `
  },
  
  sms_gentle: 'Ehi, il Whoop non vede attività oggi. Cyclette? Bici? Anche 15 min! 💪',
  
  sms_reminder: 'Mattia. Ore di inattività. Il piano era chiaro. Muoviti.',
  
  sms_aggressive: '🔴 NESSUN WORKOUT. 93kg. Diabete in famiglia. MUOVI IL CULO ADESSO.',
  
  sms_shame: 'Giornata persa. Zero attività. Domani ricomincia, ma oggi hai fallito.'
};

// ============================================
// FUNZIONI DI INVIO
// ============================================

export async function sendEmail(to, type) {
  const template = MESSAGES[type];
  if (!template) {
    throw new Error(`Unknown email type: ${type}`);
  }
  
  try {
    const result = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: to,
      subject: template.subject,
      html: template.html
    });
    
    console.log(`📧 Email sent (${type}) to ${to}:`, result.id);
    return result;
  } catch (error) {
    console.error(`Failed to send email (${type}):`, error);
    throw error;
  }
}

export async function sendSMS(to, type) {
  const message = MESSAGES[type];
  if (!message) {
    throw new Error(`Unknown SMS type: ${type}`);
  }
  
  // Usa WhatsApp se configurato
  if (process.env.USE_WHATSAPP === 'true') {
    return sendWhatsApp(to, message);
  }
  
  // Altrimenti usa Twilio
  if (!twilioClient) {
    console.log(`📱 SMS skipped (Twilio not configured): ${type}`);
    return null;
  }
  
  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: to
    });
    
    console.log(`📱 SMS sent (${type}) to ${to}:`, result.sid);
    return result;
  } catch (error) {
    console.error(`Failed to send SMS (${type}):`, error);
    throw error;
  }
}

// WhatsApp via TextMeBot
async function sendWhatsApp(to, message) {
  const apikey = process.env.TEXTMEBOT_APIKEY;
  if (!apikey) {
    console.log('📱 WhatsApp skipped (TEXTMEBOT_APIKEY not set)');
    return null;
  }
  
  // Formatta numero (rimuovi + e spazi)
  const phone = to.replace(/[^0-9]/g, '');
  
  // Encode messaggio per URL
  const encodedMessage = encodeURIComponent(message);
  
  const url = `https://api.textmebot.com/send.php?recipient=${phone}&apikey=${apikey}&text=${encodedMessage}`;
  
  try {
    const response = await fetch(url);
    const text = await response.text();
    
    if (response.ok && !text.includes('error')) {
      console.log(`📱 WhatsApp sent to ${to}`);
      return { success: true, response: text };
    } else {
      throw new Error(`TextMeBot error: ${text}`);
    }
  } catch (error) {
    console.error('Failed to send WhatsApp:', error);
    throw error;
  }
}

// Email di successo quando fai attività
export async function sendSuccessEmail(to, workoutData) {
  try {
    const result = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: to,
      subject: '✅ Bravo Mattia! Workout registrato!',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background: #e8f5e9; padding: 20px;">
          <h2 style="color: #27ae60;">Grande! 💪</h2>
          <p>Il Whoop ha registrato attività oggi:</p>
          <ul>
            ${workoutData.type ? `<li>Tipo: ${workoutData.type}</li>` : ''}
            ${workoutData.strain ? `<li>Strain: ${workoutData.strain.toFixed(1)}</li>` : ''}
            ${workoutData.calories ? `<li>Calorie: ${workoutData.calories} kcal</li>` : ''}
            ${workoutData.duration_minutes ? `<li>Durata: ${workoutData.duration_minutes} min</li>` : ''}
          </ul>
          <p>Continua così. Un giorno alla volta.</p>
          <p>🎯 Obiettivo Pasqua: 85 kg</p>
        </div>
      `
    });
    
    console.log(`📧 Success email sent to ${to}`);
    return result;
  } catch (error) {
    console.error('Failed to send success email:', error);
    throw error;
  }
}

// Email riepilogo settimanale
export async function sendWeeklyReport(to, stats) {
  try {
    const result = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: to,
      subject: `📊 Report settimanale - ${stats.workouts_done}/7 giorni`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Report Settimanale</h2>
          
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #ddd;">Workout completati</td>
              <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right;"><strong>${stats.workouts_done}/7</strong></td>
            </tr>
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #ddd;">Streak attuale</td>
              <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right;"><strong>${stats.current_streak} giorni</strong></td>
            </tr>
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #ddd;">Peso attuale</td>
              <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right;"><strong>${stats.current_weight} kg</strong></td>
            </tr>
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #ddd;">Variazione peso</td>
              <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right; color: ${stats.weight_change <= 0 ? '#27ae60' : '#c0392b'};">
                <strong>${stats.weight_change > 0 ? '+' : ''}${stats.weight_change} kg</strong>
              </td>
            </tr>
          </table>
          
          <p style="margin-top: 20px;">
            ${stats.workouts_done >= 5 
              ? '🎉 Ottima settimana! Continua così!' 
              : stats.workouts_done >= 3 
                ? '👍 Settimana ok, puoi fare meglio!'
                : '⚠️ Settimana scarsa. Impegnati di più!'}
          </p>
          
          <p style="color: #666;">🎯 Obiettivo Pasqua: 85 kg (mancano ${stats.current_weight - 85} kg)</p>
        </div>
      `
    });
    
    console.log(`📧 Weekly report sent to ${to}`);
    return result;
  } catch (error) {
    console.error('Failed to send weekly report:', error);
    throw error;
  }
}

export { MESSAGES };
