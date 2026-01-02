import { Router } from 'express';

const router = Router();

// Whoop non supporta webhooks pubblici facilmente,
// quindi usiamo polling. Ma questo è pronto per future espansioni.

router.post('/whoop', async (req, res) => {
  console.log('Webhook received:', req.body);
  res.status(200).json({ received: true });
});

export default router;
