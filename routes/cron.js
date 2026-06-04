const express = require('express')
const webpush = require('web-push')
const supabase = require('../lib/supabase')

const router = express.Router()

webpush.setVapidDetails(
  'mailto:contact@fidelite.app',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

// Appelé chaque jour par Railway cron
// Envoie une notif aux clients inactifs depuis 15 jours
router.post('/inactive-clients', async (req, res) => {
  // Vérification clé secrète pour sécuriser l'endpoint
  const secret = req.headers['x-cron-secret']
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Non autorisé' })
  }

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 15)

  // Trouver les clients qui n'ont pas eu de passage depuis 15 jours
  const { data: passagesRecents } = await supabase
    .from('passages')
    .select('client_id')
    .gte('created_at', cutoff.toISOString())

  const clientsActifs = new Set((passagesRecents || []).map(p => p.client_id))

  // Récupérer tous les abonnés push
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('*, clients(id, prenom, commercant_id), commercants(nom_enseigne, emoji, reward_desc)')

  if (!subscriptions?.length) return res.json({ sent: 0 })

  let sent = 0
  for (const sub of subscriptions) {
    const clientId = sub.client_id
    if (clientsActifs.has(clientId)) continue // Client actif, on skip

    const enseigne = sub.clients?.commercant_id
    const nomEnseigne = sub.commercants?.nom_enseigne || 'votre enseigne'
    const emoji = sub.commercants?.emoji || '🏪'

    const payload = JSON.stringify({
      title: `${emoji} ${nomEnseigne} vous manque !`,
      body: `Ça fait 15 jours que vous n'êtes pas venu(e). Revenez vite pour cumuler vos points ! 🎁`
    })

    try {
      await webpush.sendNotification(sub.subscription, payload)
      sent++
    } catch (err) {
      if (err.statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id)
      }
    }
  }

  res.json({ sent, checked: subscriptions.length })
})

module.exports = router
