-- ============================================
-- WHOOP NAGGER - Database Setup
-- Esegui questo SQL nella console Supabase
-- ============================================

-- Tabella utente principale (per ora solo tu)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  whoop_user_id BIGINT,
  whoop_access_token TEXT,
  whoop_refresh_token TEXT,
  whoop_token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Peso settimanale
CREATE TABLE IF NOT EXISTS weight_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  weight_kg DECIMAL(5,2) NOT NULL,
  logged_at DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, logged_at)
);

-- Attività giornaliera (cache da Whoop + manuale)
CREATE TABLE IF NOT EXISTS daily_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  workout_done BOOLEAN DEFAULT FALSE,
  workout_strain DECIMAL(4,2),
  workout_calories INTEGER,
  workout_type TEXT,
  recovery_score INTEGER,
  sleep_performance INTEGER,
  meals_ok BOOLEAN DEFAULT TRUE,
  alcohol BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- Log dei reminder inviati
CREATE TABLE IF NOT EXISTS reminder_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'email_gentle', 'email_aggressive', 'sms', 'sms_aggressive'
  message TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- Impostazioni reminder
CREATE TABLE IF NOT EXISTS reminder_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT TRUE,
  start_hour INTEGER DEFAULT 10,  -- Inizia a rompere alle 10
  end_hour INTEGER DEFAULT 21,    -- Smette alle 21
  email_interval_hours INTEGER DEFAULT 3,
  sms_interval_hours INTEGER DEFAULT 4,
  aggressive_after_hours INTEGER DEFAULT 6, -- Diventa cattivo dopo 6 ore
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Streak e statistiche
CREATE TABLE IF NOT EXISTS stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  total_workouts INTEGER DEFAULT 0,
  total_kg_lost DECIMAL(5,2) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Funzione per aggiornare updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger per updated_at
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER daily_activity_updated_at
  BEFORE UPDATE ON daily_activity
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER stats_updated_at
  BEFORE UPDATE ON stats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Indici per performance
CREATE INDEX IF NOT EXISTS idx_daily_activity_user_date ON daily_activity(user_id, date);
CREATE INDEX IF NOT EXISTS idx_weight_logs_user_date ON weight_logs(user_id, logged_at);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_user_sent ON reminder_logs(user_id, sent_at);

-- ============================================
-- INSERISCI TE STESSO COME UTENTE
-- Sostituisci con i tuoi dati reali
-- ============================================
INSERT INTO users (email, phone) 
VALUES ('mattia@mpsh.it', '+39XXXXXXXXXX')
ON CONFLICT (email) DO NOTHING;

-- Inserisci settings di default per te
INSERT INTO reminder_settings (user_id, enabled, start_hour, end_hour)
SELECT id, true, 9, 21 FROM users WHERE email = 'mattia@mpsh.it'
ON CONFLICT (user_id) DO NOTHING;

-- Inserisci stats iniziali
INSERT INTO stats (user_id, current_streak, longest_streak)
SELECT id, 0, 0 FROM users WHERE email = 'mattia@mpsh.it'
ON CONFLICT (user_id) DO NOTHING;

-- Inserisci peso iniziale (93 kg - 3 gennaio 2025)
INSERT INTO weight_logs (user_id, weight_kg, logged_at)
SELECT id, 93.0, '2025-01-03' FROM users WHERE email = 'mattia@mpsh.it'
ON CONFLICT (user_id, logged_at) DO NOTHING;
