const express = require('express')
const jwt = require('jsonwebtoken')
const supabase = require('../lib/supabase')

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

  const { data, error } = await supabase
    .from('clients')
    .insert([{ id, commercant_id: req.commercant.id, prenom, nom, telephone, email }])
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.status(201).json(data)
})

router.post('/:id/scan', async (req, res) => {
  const { id } = req.params
  const { note } = req.body

  const { data: commercant, error: cErr } = await supabase
    .from('commercants')
    .select('pts_par_passage')
    .eq('id', req.commercant.id)
    .single()

  if (cErr) return res.status(500).json({ error: cErr.message })

  const pts = commercant.pts_par_passage || 1

  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('points, commercant_id')
    .eq('id', id)
    .single()

  if (clientErr || !client) return res.status(404).json({ error: 'Client introuvable' })
  if (client.commercant_id !== req.commercant.id) return res.status(403).json({ error: 'Accès refusé' })

  const newPoints = (client.points || 0) + pts

  const [updateResult, passageResult] = await Promise.all([
    supabase.from('clients').update({ points: newPoints }).eq('id', id).select().single(),
    supabase.from('passages').insert([{ client_id: id, commercant_id: req.commercant.id, points_ajoutes: pts, note }])
  ])

  if (updateResult.error) return res.status(500).json({ error: updateResult.error.message })
  res.json({ client: updateResult.data, points_ajoutes: pts })
})

// Réinitialiser les points après récompense
router.post('/:id/reset', async (req, res) => {
  const { id } = req.params

  const { data: client } = await supabase.from('clients').select('commercant_id, points').eq('id', id).single()
  if (!client) return res.status(404).json({ error: 'Client introuvable' })
  if (client.commercant_id !== req.commercant.id) return res.status(403).json({ error: 'Accès refusé' })

  const { data, error } = await supabase.from('clients').update({ points: 0 }).eq('id', id).select().single()
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
