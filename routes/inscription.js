const express = require('express')
const webpush = require('web-push')
const supabase = require('../lib/supabase')

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails('mailto:contact@fidelite.app', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)
}

async function sendPushToClient(clientId, title, body) {
  const { data: subs } = await supabase.from('push_subscriptions').select('*').eq('client_id', clientId)
  if (!subs?.length) return
  const payload = JSON.stringify({ title, body })
  for (const sub of subs) {
    try { await webpush.sendNotification(sub.subscription, payload) }
    catch (e) { if (e.statusCode === 410) await supabase.from('push_subscriptions').delete().eq('id', sub.id) }
  }
}

const router = express.Router()

function generateId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = 'ID-'
  for (let i = 0; i < 6; i++) result += chars[Math.floor(Math.random() * chars.length)]
  return result
}

// Infos de l'enseigne pour la page d'inscription
router.get('/:commercant_id', async (req, res) => {
  const { data, error } = await supabase
    .from('commercants')
    .select('id, nom_enseigne, type_activite, emoji, couleur, icon_url, pts_par_passage, seuil_reward, reward_desc, parrainage_actif, mode_points')
    .eq('id', req.params.commercant_id)
    .single()

  if (error || !data) return res.status(404).json({ error: 'Enseigne introuvable' })
  res.json(data)
})

// Inscription d'un nouveau client
router.post('/:commercant_id', async (req, res) => {
  const { prenom, nom, telephone, email, referral_code } = req.body
  const { commercant_id } = req.params

  if (!prenom) return res.status(400).json({ error: 'Le prénom est requis' })

  const { data: commercant } = await supabase
    .from('commercants')
    .select('id, nom_enseigne, pts_par_passage, parrainage_actif')
    .eq('id', commercant_id)
    .single()

  if (!commercant) return res.status(404).json({ error: 'Enseigne introuvable' })

  // Vérifier le code de parrainage
  let referred_by = null
  if (referral_code) {
    const { data: parrain } = await supabase
      .from('clients')
      .select('id, points, commercant_id')
      .eq('referral_code', referral_code.toUpperCase())
      .single()
    if (parrain && parrain.commercant_id === commercant_id) {
      referred_by = parrain.id
    }
  }

  // Générer un ID unique
  let id, exists
  do {
    id = generateId()
    const { data } = await supabase.from('clients').select('id').eq('id', id).single()
    exists = !!data
  } while (exists)

  // Générer un code de parrainage unique
  let refCode, refExists
  do {
    refCode = Math.random().toString(36).substring(2, 8).toUpperCase()
    const { data } = await supabase.from('clients').select('id').eq('referral_code', refCode).single()
    refExists = !!data
  } while (refExists)

  const { data, error } = await supabase
    .from('clients')
    .insert([{ id, commercant_id, prenom, nom, telephone, email, referred_by, referral_code: refCode }])
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })

  // Le bonus parrainage est géré au 1er scan dans clients.js (évite le double crédit)

  // Notif de bienvenue (après un court délai pour que la subscription soit créée)
  setTimeout(async () => {
    await sendPushToClient(data.id,
      `Bienvenue ${prenom} ! 🎉`,
      `Votre carte ${commercant.nom_enseigne} est prête. Revenez souvent pour cumuler vos points ! 🎁`
    )
  }, 5000)

  res.status(201).json({ ...data, parrainage_valide: !!referred_by })
})

module.exports = router
