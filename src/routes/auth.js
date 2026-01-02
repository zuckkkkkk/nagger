import { Router } from 'express';
import dotenv from 'dotenv';
import { getAuthUrl, exchangeCodeForTokens, getUserProfile } from '../lib/whoop.js';
import { getUser, supabase } from '../lib/supabase.js';

dotenv.config();

const router = Router();

// Inizia OAuth flow
router.get('/whoop', (req, res) => {
  const authUrl = getAuthUrl();
  res.redirect(authUrl);
});

// Callback OAuth
router.get('/whoop/callback', async (req, res) => {
  const { code, error, error_description } = req.query;
  
  if (error) {
    console.error('OAuth error:', error, error_description);
    return res.redirect(`/?error=${encodeURIComponent(error_description || error)}`);
  }
  
  if (!code) {
    return res.redirect('/?error=No%20code%20received');
  }
  
  try {
    // Scambia code per tokens
    const tokens = await exchangeCodeForTokens(code);
    console.log('Tokens received:', { 
      expires_in: tokens.expires_in,
      scope: tokens.scope 
    });
    
    // Ottieni profilo utente Whoop
    const profile = await getUserProfile(tokens.access_token);
    console.log('Whoop profile:', profile);
    
    // Aggiorna utente nel database
    const { error: updateError } = await supabase
      .from('users')
      .update({
        whoop_user_id: profile.user_id,
        whoop_access_token: tokens.access_token,
        whoop_refresh_token: tokens.refresh_token,
        whoop_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      })
      .eq('email', profile.email);
    
    if (updateError) {
      // Se l'email non corrisponde, prova a cercare l'utente principale
      console.log('Email mismatch, updating primary user...');
      const { error: updateError2 } = await supabase
        .from('users')
        .update({
          whoop_user_id: profile.user_id,
          whoop_access_token: tokens.access_token,
          whoop_refresh_token: tokens.refresh_token,
          whoop_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        })
        .eq('email', process.env.YOUR_EMAIL);
      
      if (updateError2) {
        throw updateError2;
      }
    }
    
    console.log('✅ Whoop connected for:', profile.email);
    res.redirect('/?success=whoop_connected');
    
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(`/?error=${encodeURIComponent(err.message)}`);
  }
});

// Status check
router.get('/status', async (req, res) => {
  try {
    const user = await getUser(process.env.YOUR_EMAIL);
    
    res.json({
      whoop_connected: !!user.whoop_access_token,
      whoop_user_id: user.whoop_user_id,
      token_expires_at: user.whoop_token_expires_at
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
