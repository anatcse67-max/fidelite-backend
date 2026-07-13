const express = require('express')
const jwt = require('jsonwebtoken')
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

function authMiddleware(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' })
  }
  try {
    req.commercant = jwt.verify(header.slice(7), process.env.JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Token invalide' })
  }
}

function generateId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = 'ID-'
  for (let i = 0; i < 6; i++) result += chars[Math.floor(Math.random() * chars.length)]
  return result
}

router.use(authMiddleware)

router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('commercant_id', req.commercant.id)
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })

  // Compter les passages pour chaque client
  const clients = await Promise.all(data.map(async c => {
    const { count } = await supabase
      .from('passages')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', c.id)
    return { ...c, nb_passages: count || 0 }
  }))

  res.json(clients)
})

// Export CSV
router.get('/export', async (req, res) => {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('commercant_id', req.commercant.id)
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })

  const header = 'ID,Prénom,Nom,Téléphone,Email,Points,Date inscription'
  const rows = data.map(c =>
    `${c.id},"${c.prenom || ''}","${c.nom || ''}","${c.telephone || ''}","${c.email || ''}",${c.points},"${new Date(c.created_at).toLocaleDateString('fr-FR')}"`
  )
  const csv = [header, ...rows].join('\n')

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="clients.csv"')
  res.send('﻿' + csv) // BOM pour Excel
})

router.post('/', async (req, res) => {
  const { prenom, nom, telephone, email } = req.body

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
    .insert([{ id, commercant_id: req.commercant.id, prenom, nom, telephone, email, referral_code: refCode }])
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.status(201).json(data)
})

router.post('/:id/scan', async (req, res) => {
  const { id } = req.params
  const { note, montant } = req.body

  // Récupérer toutes les infos du commerçant en une seule requête
  const { data: commercant, error: cErr } = await supabase
    .from('commercants')
    .select('pts_par_passage, nom_enseigne, seuil_reward, reward_desc, mode_points, euro_to_points, parrainage_actif, parrainage_points, parrainage_nb_min, reward_expiry_days, points_expiry_days')
    .eq('id', req.commercant.id)
    .single()

  if (cErr) return res.status(500).json({ error: cErr.message })

  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('points, commercant_id, referred_by, parrainage_valide, reward_unlocked_at')
    .eq('id', id)
    .single()

  if (clientErr || !client) return res.status(404).json({ error: 'Client introuvable' })
  if (client.commercant_id !== req.commercant.id) return res.status(403).json({ error: 'Accès refusé' })

  // Compter les passages existants (pour détecter le 1er scan + date du dernier)
  const { count: nbPassages } = await supabase
    .from('passages')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', id)

  const isPremierScan = nbPassages === 0

  let oldPoints = client.points || 0
  const clientUpdates = {}
  const now = new Date()

  // Vérifier expiration des points (inactivité)
  let pointsExpires = false
  if (commercant.points_expiry_days && !isPremierScan) {
    const { data: lastPassage } = await supabase
      .from('passages')
      .select('created_at')
      .eq('client_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (lastPassage) {
      const daysSinceLast = (now - new Date(lastPassage.created_at)) / (1000 * 60 * 60 * 24)
      if (daysSinceLast > commercant.points_expiry_days) {
        pointsExpires = true
        oldPoints = 0
        clientUpdates.points = 0
        clientUpdates.reward_unlocked_at = null
        await supabase.from('passages').insert([{
          client_id: id, commercant_id: req.commercant.id, points_ajoutes: 0,
          note: `⏰ Points expirés (inactivité > ${commercant.points_expiry_days} jours)`
        }])
        sendPushToClient(id, '⏰ Points expirés', `Tes points chez ${commercant.nom_enseigne} ont expiré après ${commercant.points_expiry_days} jours d'inactivité.`)
      }
    }
  }

  // Vérifier expiration de la récompense débloquée
  let rewardExpire = false
  if (commercant.reward_expiry_days && client.reward_unlocked_at && !pointsExpires) {
    const daysWithReward = (now - new Date(client.reward_unlocked_at)) / (1000 * 60 * 60 * 24)
    if (daysWithReward > commercant.reward_expiry_days) {
      rewardExpire = true
      oldPoints = 0
      clientUpdates.points = 0
      clientUpdates.reward_unlocked_at = null
      await supabase.from('passages').insert([{
        client_id: id, commercant_id: req.commercant.id, points_ajoutes: 0,
        note: `⏰ Récompense expirée (non utilisée après ${commercant.reward_expiry_days} jours)`
      }])
      sendPushToClient(id, '⏰ Récompense expirée', `Ta récompense chez ${commercant.nom_enseigne} a expiré car elle n'a pas été utilisée à temps.`)
    }
  }

  // Calculer les points selon le mode
  let pts
  if (commercant.mode_points === 'montant' && montant) {
    pts = Math.floor(parseFloat(montant) * (commercant.euro_to_points || 1))
  } else {
    pts = commercant.pts_par_passage || 1
  }

  const newPoints = oldPoints + pts

  // Détecter si la récompense principale vient d'être débloquée
  const seuilAtteint = commercant.seuil_reward && newPoints >= commercant.seuil_reward && oldPoints < commercant.seuil_reward
  if (seuilAtteint) clientUpdates.reward_unlocked_at = now.toISOString()

  // Mise à jour points + enregistrement passage
  clientUpdates.points = newPoints
  const [updateResult] = await Promise.all([
    supabase.from('clients').update(clientUpdates).eq('id', id).select().single(),
    supabase.from('passages').insert([{ client_id: id, commercant_id: req.commercant.id, points_ajoutes: pts, note: note || (commercant.mode_points === 'montant' && montant ? `${montant}€` : null) }])
  ])

  if (updateResult.error) return res.status(500).json({ error: updateResult.error.message })

  // Push Apple Wallet (sans bloquer la réponse)
  try {
    const { pushWalletUpdate } = require('./walletService')
    pushWalletUpdate(id).catch(e => console.warn('Wallet push error:', e.message))
  } catch (_) {}

  // Vérifier paliers débloqués
  const { data: paliers } = await supabase
    .from('paliers')
    .select('*')
    .eq('commercant_id', req.commercant.id)
    .order('points_requis', { ascending: true })

  const palierDebloque = paliers?.find(p => newPoints >= p.points_requis && oldPoints < p.points_requis)
  if (palierDebloque) {
    const rewardText = palierDebloque.type === 'reduction'
      ? `-${palierDebloque.valeur}% de réduction`
      : palierDebloque.description
    sendPushToClient(id, `🎁 Récompense débloquée !`, `${palierDebloque.points_requis} pts atteints chez ${commercant.nom_enseigne} ! ${rewardText}`)
  }

  // Parrainage : valider au 1er scan si pas encore validé
  let parrainageBonus = null
  if (isPremierScan && client.referred_by && !client.parrainage_valide && commercant.parrainage_actif) {
    // Marquer le parrainage comme validé
    await supabase.from('clients').update({ parrainage_valide: true }).eq('id', id)

    // Compter les parrainages validés du parrain
    const { count: nbParrainages } = await supabase
      .from('clients')
      .select('*', { count: 'exact', head: true })
      .eq('referred_by', client.referred_by)
      .eq('parrainage_valide', true)

    // Vérifier si le seuil de parrainages est atteint
    const nbMin = commercant.parrainage_nb_min || 1
    if (nbParrainages % nbMin === 0) {
      const bonusPts = commercant.parrainage_points || 5
      const { data: parrain } = await supabase.from('clients').select('points, prenom').eq('id', client.referred_by).single()
      if (parrain) {
        await supabase.from('clients').update({ points: parrain.points + bonusPts }).eq('id', client.referred_by)
        await supabase.from('passages').insert([{
          client_id: client.referred_by,
          commercant_id: req.commercant.id,
          points_ajoutes: bonusPts,
          note: `🤝 Parrainage validé — ${nbParrainages} filleul(s) actif(s) — +${bonusPts} pts`
        }])
        sendPushToClient(client.referred_by, `🤝 Parrainage validé !`, `Votre filleul vient de faire son premier passage chez ${commercant.nom_enseigne}. +${bonusPts} pts pour vous !`)
        parrainageBonus = { parrain_id: client.referred_by, points: bonusPts }
      }
    }
  }

  res.json({ client: updateResult.data, points_ajoutes: pts, palier_debloque: palierDebloque || null, parrainage_bonus: parrainageBonus, points_expires: pointsExpires, reward_expire: rewardExpire })
})

// Réinitialiser les points après récompense
router.post('/:id/reset', async (req, res) => {
  const { id } = req.params

  const { data: client } = await supabase.from('clients').select('commercant_id, points').eq('id', id).single()
  if (!client) return res.status(404).json({ error: 'Client introuvable' })
  if (client.commercant_id !== req.commercant.id) return res.status(403).json({ error: 'Accès refusé' })

  const { data, error } = await supabase.from('clients').update({ points: 0, reward_unlocked_at: null }).eq('id', id).select().single()
  if (error) return res.status(500).json({ error: error.message })

  // Enregistrer le reset comme passage spécial
  await supabase.from('passages').insert([{
    client_id: id,
    commercant_id: req.commercant.id,
    points_ajoutes: 0,
    note: `🎁 Récompense récupérée — points remis à zéro (${client.points} pts)`
  }])

  res.json({ client: data })
})

// Retirer des points manuellement
router.post('/:id/retirer-points', async (req, res) => {
  const { id } = req.params
  const { points, note } = req.body
  if (!points || points <= 0) return res.status(400).json({ error: 'Nombre de points invalide' })

  const { data: client } = await supabase.from('clients').select('commercant_id, points').eq('id', id).single()
  if (!client) return res.status(404).json({ error: 'Client introuvable' })
  if (client.commercant_id !== req.commercant.id) return res.status(403).json({ error: 'Accès refusé' })

  const newPoints = Math.max(0, client.points - points)
  const [updateResult] = await Promise.all([
    supabase.from('clients').update({ points: newPoints }).eq('id', id).select().single(),
    supabase.from('passages').insert([{ client_id: id, commercant_id: req.commercant.id, points_ajoutes: -points, note: note || `🎁 Récompense utilisée — -${points} pts` }])
  ])
  if (updateResult.error) return res.status(500).json({ error: updateResult.error.message })
  res.json({ client: updateResult.data })
})

// Paliers du commerçant
router.get('/paliers', async (req, res) => {
  const { data, error } = await supabase.from('paliers').select('*').eq('commercant_id', req.commercant.id).order('points_requis')
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post('/paliers', async (req, res) => {
  const { points_requis, description, type, valeur } = req.body
  if (!points_requis || !description) return res.status(400).json({ error: 'Champs requis' })
  const { data, error } = await supabase.from('paliers')
    .insert([{ commercant_id: req.commercant.id, points_requis, description, type: type || 'texte', valeur }])
    .select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.delete('/paliers/:palier_id', async (req, res) => {
  const { data: palier } = await supabase.from('paliers').select('commercant_id').eq('id', req.params.palier_id).single()
  if (!palier || palier.commercant_id !== req.commercant.id) return res.status(403).json({ error: 'Accès refusé' })
  await supabase.from('paliers').delete().eq('id', req.params.palier_id)
  res.json({ success: true })
})

router.delete('/:id', async (req, res) => {
  const { id } = req.params

  const { data: client } = await supabase.from('clients').select('commercant_id').eq('id', id).single()
  if (!client) return res.status(404).json({ error: 'Client introuvable' })
  if (client.commercant_id !== req.commercant.id) return res.status(403).json({ error: 'Accès refusé' })

  const { error } = await supabase.from('clients').delete().eq('id', id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ success: true })
})

module.exports = router
