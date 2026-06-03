const express = require('express')
const jwt = require('jsonwebtoken')
const supabase = require('../lib/supabase')

const router = express.Router()

function authMiddleware(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Token manquant' })
  try {
    req.commercant = jwt.verify(header.slice(7), process.env.JWT_SECRET)
    next()
  } catch { res.status(401).json({ error: 'Token invalide' }) }
}

router.get('/', authMiddleware, async (req, res) => {
  const cid = req.commercant.id

  const [clientsRes, passagesRes, notifsRes] = await Promise.all([
    supabase.from('clients').select('id, points, created_at').eq('commercant_id', cid),
    supabase.from('passages').select('points_ajoutes, created_at').eq('commercant_id', cid),
    supabase.from('notifications_history').select('id').eq('commercant_id', cid)
  ])

  const clients = clientsRes.data || []
  const passages = passagesRes.data || []

  // Passages des 7 derniers jours
  const now = new Date()
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now)
    d.setDate(d.getDate() - (6 - i))
    return d.toISOString().slice(0, 10)
  })

  const passagesParJour = days.map(day => ({
    day: day.slice(5), // MM-DD
    count: passages.filter(p => p.created_at.slice(0, 10) === day).length
  }))

  // Top clients par points
  const topClients = [...clients]
    .sort((a, b) => b.points - a.points)
    .slice(0, 5)

  // Total points distribués
  const totalPoints = passages.reduce((sum, p) => sum + p.points_ajoutes, 0)

  // Nouveaux clients cette semaine
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
  const newClients = clients.filter(c => c.created_at > weekAgo).length

  res.json({
    totalClients: clients.length,
    totalPassages: passages.length,
    totalPoints,
    newClientsThisWeek: newClients,
    passagesParJour,
    topClients,
    totalNotifications: notifsRes.data?.length || 0
  })
})

module.exports = router
