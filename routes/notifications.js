const express = require('express')
const jwt = require('jsonwebtoken')
const webpush = require('web-push')
const supabase = require('../lib/supabase')

const router = express.Router()

webpush.setVapidDetails(
  'mailto:contact@fidelite.app',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

function authMiddleware(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Token manquant' })
  try {
    req.commercant = jwt.verify(header.slice(7), process.env.JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Token invalide' })
  }
}

// Clé publique VAPID (pour le frontend)
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY })
})

// Le client s'abonne aux notifications
router.post('/subscribe', async (req, res) => {
  const { subscription, client_id, commercant_id } = req.body
  if (!subscription || !client_id || !commercant_id) {
    return res.status(400).json({ error: 'Données manquantes' })
  }

  // Vérifie si déjà abonné avec ce endpoint
  const { data: existing } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('client_id', client_id)
    .eq('subscription->endpoint', subscription.endpoint)
    .single()

  if (existing) return res.json({ success: true, already: true })

  const { error } = await supabase
    .from('push_subscriptions')
    .insert([{ client_id, commercant_id, subscription }])

  if (error) return res.status(500).json({ error: error.message })
  res.json({ success: true })
})

// Le commerçant envoie une notification à tous ses clients
router.post('/send', authMiddleware, async (req, res) => {
  const { title, body, client_id } = req.body
  if (!title || !body) return res.status(400).json({ error: 'Titre et message requis' })

  let query = supabase
    .from('push_subscriptions')
    .select('*')
    .eq('commercant_id', req.commercant.id)

  if (client_id) query = query.eq('client_id', client_id)

  const { data: subscriptions, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  if (!subscriptions.length) return res.json({ sent: 0, message: 'Aucun abonné' })

  const payload = JSON.stringify({ title, body })
  let sent = 0, failed = 0

  await Promise.all(subscriptions.map(async sub => {
    try {
      await webpush.sendNotification(sub.subscription, payload)
      sent++
    } catch (err) {
      failed++
      // Supprimer les abonnements expirés
      if (err.statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id)
      }
    }
  }))

  res.json({ sent, failed })
})

module.exports = router
