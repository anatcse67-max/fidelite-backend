const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const supabase = require('../lib/supabase')

const router = express.Router()

// Middleware admin
function adminAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Token manquant' })
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET)
    if (!payload.isAdmin) return res.status(403).json({ error: 'Accès refusé' })
    next()
  } catch { res.status(401).json({ error: 'Token invalide' }) }
}

// Login admin
router.post('/login', async (req, res) => {
  const { email, password } = req.body
  if (email !== process.env.ADMIN_EMAIL) return res.status(401).json({ error: 'Identifiants invalides' })
  const valid = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH)
  if (!valid) return res.status(401).json({ error: 'Identifiants invalides' })
  const token = jwt.sign({ isAdmin: true, email }, process.env.JWT_SECRET, { expiresIn: '7d' })
  res.json({ token })
})

// Stats globales
router.get('/stats', adminAuth, async (req, res) => {
  const [
    { count: totalCommercants },
    { count: totalClients },
    { count: totalPassages },
  ] = await Promise.all([
    supabase.from('commercants').select('*', { count: 'exact', head: true }),
    supabase.from('clients').select('*', { count: 'exact', head: true }),
    supabase.from('passages').select('*', { count: 'exact', head: true }),
  ])

  // Passages aujourd'hui
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const { count: passagesToday } = await supabase
    .from('passages')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', today.toISOString())

  // Nouveaux commerçants ce mois
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const { count: newCommercants } = await supabase
    .from('commercants')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', firstOfMonth.toISOString())

  res.json({ totalCommercants, totalClients, totalPassages, passagesToday, newCommercants })
})

// Liste tous les commerçants avec leurs stats
router.get('/commercants', adminAuth, async (req, res) => {
  const { data: commercants, error } = await supabase
    .from('commercants')
    .select('id, email, nom_enseigne, type_activite, emoji, couleur, icon_url, created_at, suspended, latitude, longitude, adresse')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })

  const enriched = await Promise.all(commercants.map(async c => {
    const [{ count: nbClients }, { count: nbPassages }] = await Promise.all([
      supabase.from('clients').select('*', { count: 'exact', head: true }).eq('commercant_id', c.id),
      supabase.from('passages').select('*', { count: 'exact', head: true }).eq('commercant_id', c.id),
    ])

    // Dernier passage
    const { data: lastPassage } = await supabase
      .from('passages')
      .select('created_at')
      .eq('commercant_id', c.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    return { ...c, nbClients: nbClients || 0, nbPassages: nbPassages || 0, lastActivity: lastPassage?.created_at || null }
  }))

  res.json(enriched)
})

// Détail d'un commerçant
router.get('/commercants/:id', adminAuth, async (req, res) => {
  const { id } = req.params

  const { data: commercant, error } = await supabase
    .from('commercants')
    .select('id, email, nom_enseigne, type_activite, emoji, couleur, icon_url, created_at, suspended, pts_par_passage, seuil_reward, reward_desc, latitude, longitude, adresse')
    .eq('id', id)
    .single()

  if (error || !commercant) return res.status(404).json({ error: 'Commerçant introuvable' })

  // Clients
  const { data: clients } = await supabase
    .from('clients')
    .select('id, prenom, nom, points, created_at')
    .eq('commercant_id', id)
    .order('created_at', { ascending: false })

  // Passages par jour (30 derniers jours)
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const { data: passages } = await supabase
    .from('passages')
    .select('created_at, points_ajoutes')
    .eq('commercant_id', id)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true })

  // Grouper par jour
  const passagesParJour = {}
  passages?.forEach(p => {
    const day = p.created_at.slice(0, 10)
    passagesParJour[day] = (passagesParJour[day] || 0) + 1
  })

  res.json({
    commercant,
    clients: clients || [],
    passagesParJour: Object.entries(passagesParJour).map(([date, count]) => ({ date, count }))
  })
})

// Suspendre / réactiver un commerçant
router.patch('/commercants/:id/suspend', adminAuth, async (req, res) => {
  const { id } = req.params
  const { suspended } = req.body

  const { data, error } = await supabase
    .from('commercants')
    .update({ suspended })
    .eq('id', id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ commercant: data })
})

// Mettre à jour la position géo d'un commerçant
router.patch('/commercants/:id/geo', adminAuth, async (req, res) => {
  const { id } = req.params
  const { latitude, longitude, adresse } = req.body

  const { data, error } = await supabase
    .from('commercants')
    .update({ latitude, longitude, adresse })
    .eq('id', id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ commercant: data })
})

// Supprimer un commerçant et toutes ses données
router.delete('/commercants/:id', adminAuth, async (req, res) => {
  const { id } = req.params

  // Supprimer dans l'ordre pour respecter les foreign keys
  const clientIds = await supabase.from('clients').select('id').eq('commercant_id', id)
  if (clientIds.data?.length) {
    const ids = clientIds.data.map(c => c.id)
    await supabase.from('push_subscriptions').delete().in('client_id', ids)
    await supabase.from('passages').delete().in('client_id', ids)
    await supabase.from('clients').delete().eq('commercant_id', id)
  }
  await supabase.from('notifications_his').delete().eq('commercant_id', id)
  await supabase.from('commercants').delete().eq('id', id)

  res.json({ success: true })
})

module.exports = router
