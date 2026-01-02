# 🏃 WHOOP NAGGER

Sistema che ti stressa via email e SMS finché non fai attività fisica.

## Come Funziona

1. Si collega al tuo Whoop via OAuth
2. Ogni 30 minuti controlla se hai fatto workout
3. Se non hai fatto niente, ti bombarda di email/SMS con escalation di aggressività
4. La sera, se non ti sei mosso, ricevi l'email della vergogna
5. Dashboard minimale per vedere progressi e peso

## Setup Completo

### 1. Prerequisiti

- Node.js 18+
- Account Supabase (gratis)
- Account Whoop Developer
- Account Resend (email, gratis fino a 3k/mese)
- Account Twilio (SMS, pay-per-use ~0.05€/SMS)

### 2. Setup Supabase

1. Vai su [supabase.com](https://supabase.com) e crea un progetto
2. Vai su **SQL Editor**
3. Copia e incolla il contenuto di `database/setup.sql`
4. Esegui
5. **IMPORTANTE**: Modifica l'INSERT finale con la tua email e telefono
6. Copia `Project URL` e `service_role key` da Settings > API

### 3. Setup Whoop Developer

1. Vai su [developer.whoop.com](https://developer.whoop.com)
2. Accedi con il tuo account Whoop
3. Crea una nuova app:
   - Nome: "Nagger" (o quello che vuoi)
   - Redirect URI: `http://localhost:3000/auth/whoop/callback` (per test locale)
   - Scopes: tutti quelli disponibili
4. Copia `Client ID` e `Client Secret`

**Per produzione:** aggiungi anche `https://tuodominio.com/auth/whoop/callback`

### 4. Setup Resend (Email)

1. Vai su [resend.com](https://resend.com) e crea account
2. Vai su API Keys e crea una key
3. Vai su Domains e aggiungi il tuo dominio (es. mpsh.it)
4. Configura i DNS come indicato
5. Verifica il dominio

### 5. Setup Twilio (SMS)

1. Vai su [twilio.com](https://twilio.com) e crea account
2. Dalla console, copia:
   - Account SID
   - Auth Token
3. Compra un numero di telefono (~1€/mese)
4. Il numero deve essere abilitato per SMS

### 6. Configurazione

```bash
# Clona/copia il progetto
cd whoop-nagger

# Copia il file env
cp .env.example .env

# Modifica .env con i tuoi valori
nano .env
```

Contenuto `.env`:
```env
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGc...

# Whoop OAuth
WHOOP_CLIENT_ID=xxxxx
WHOOP_CLIENT_SECRET=xxxxx
WHOOP_REDIRECT_URI=http://localhost:3000/auth/whoop/callback

# Twilio SMS
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_PHONE_NUMBER=+1234567890

# Resend Email
RESEND_API_KEY=re_xxxxx
EMAIL_FROM=nagger@mpsh.it

# I tuoi dati
YOUR_PHONE_NUMBER=+39xxxxxxxxxx
YOUR_EMAIL=mattia@mpsh.it

# Server
PORT=3000
BASE_URL=http://localhost:3000
```

### 7. Installazione

```bash
npm install
```

### 8. Avvio

```bash
# Sviluppo (con auto-reload)
npm run dev

# Produzione
npm start
```

### 9. Connetti Whoop

1. Apri `http://localhost:3000`
2. Clicca "Connetti Whoop"
3. Autorizza l'app
4. Fatto!

---

## Deploy su Hetzner

### Con Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
docker build -t whoop-nagger .
docker run -d --name whoop-nagger --env-file .env -p 3000:3000 whoop-nagger
```

### Con PM2 (consigliato)

```bash
# Installa PM2
npm install -g pm2

# Avvia
pm2 start src/index.js --name whoop-nagger

# Auto-start al boot
pm2 startup
pm2 save

# Logs
pm2 logs whoop-nagger
```

### Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name nagger.mpsh.it;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name nagger.mpsh.it;
    
    ssl_certificate /etc/letsencrypt/live/nagger.mpsh.it/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/nagger.mpsh.it/privkey.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Certbot per SSL
sudo certbot --nginx -d nagger.mpsh.it
```

---

## Logica Notifiche

| Ora | Cosa succede |
|-----|--------------|
| 09:00 | Prima email gentile se no workout |
| 09:30 | Check |
| 10:00 | Check |
| 10:30 | Check |
| 11:00 | Seconda email se ancora niente |
| ... | Continua ogni ora |
| 13:00 | Primo SMS se niente |
| 15:00+ | Modalità aggressiva |
| 17:00 | SMS aggressivo |
| 21:30 | Email della vergogna se giornata persa |

**Escalation:**
1. `email_gentle` - "Ehi, ti sei mosso?"
2. `email_reminder` - "Sono passate ore..."
3. `email_aggressive` - "BASTA SCUSE"
4. `sms_gentle` - Reminder veloce
5. `sms_aggressive` - "MUOVI IL CULO"
6. `email_shame` - Report serale negativo

---

## API Endpoints

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET | `/api/dashboard` | Tutti i dati dashboard |
| POST | `/api/weight` | Log peso |
| POST | `/api/activity` | Log attività manuale |
| PUT | `/api/settings` | Aggiorna impostazioni |
| POST | `/api/sync-whoop` | Forza sync Whoop |
| POST | `/api/force-check` | Forza check manuale |
| GET | `/api/reminders` | Storico reminder |
| GET | `/auth/whoop` | Inizia OAuth |
| GET | `/auth/whoop/callback` | Callback OAuth |
| GET | `/auth/status` | Status connessione |

---

## Troubleshooting

**Whoop non si connette:**
- Verifica che il Redirect URI in Whoop Developer sia esatto
- Controlla i logs per errori OAuth

**Email non arrivano:**
- Verifica che il dominio sia verificato su Resend
- Controlla spam folder
- Verifica API key

**SMS non arrivano:**
- Verifica che il numero Twilio sia abilitato per SMS
- Il tuo numero deve essere in formato internazionale (+39...)
- Controlla credito Twilio

**Cron non parte:**
- Controlla timezone nel cron.js (Europe/Rome)
- Verifica logs: `pm2 logs whoop-nagger`

---

## Costi Stimati

| Servizio | Costo |
|----------|-------|
| Supabase | Gratis (tier free) |
| Resend | Gratis fino a 3k email/mese |
| Twilio | ~0.05€/SMS + 1€/mese numero |
| Hetzner | Già ce l'hai |

**Stima mensile:** 5-10€ (principalmente SMS)

---

## License

MIT - Fanne quello che vuoi, l'importante è che ti muovi 💪
