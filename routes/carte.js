const express = require('express')
const supabase = require('../lib/supabase')

const router = express.Router()

// Manifest dynamique pour PWA iOS
router.get('/:id/manifest.json', async (req, res) => {
  const { id } = req.params

  const { data: client } = await supabase.from('clients').select('commercant_id').eq('id', id).single()
  if (!client) return res.status(404).json({ error: 'Client introuvable' })

  const { data: commercant } = await supabase
    .from('commercants')
    .select('nom_enseigne, emoji, couleur, icon_url')
    .eq('id', client.commercant_id)
    .single()

  const origin = process.env.DASHBOARD_URL || 'https://fidelite-dashboard-kohl.vercel.app'

  // Si le commerçant a une icône custom, on l'utilise, sinon icônes par défaut
  const icons = commercant?.icon_url
    ? [
        { src: commercant.icon_url, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: commercant.icon_url, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ]
    : [
        { src: `${origin}/icon-192.png`, sizes: '192x192', type: 'image/png' },
        { src: `${origin}/icon-512.png`, sizes: '512x512', type: 'image/png' }
      ]

  res.setHeader('Content-Type', 'application/json')
  res.json({
    name: commercant ? `${commercant.emoji} ${commercant.nom_enseigne}` : 'Carte fidélité',
    short_name: commercant?.nom_enseigne || 'Fidélité',
    start_url: `${origin}/carte/${id}`,
    display: 'standalone',
    background_color: commercant?.couleur || '#6c63ff',
    theme_color: commercant?.couleur || '#6c63ff',
    icons
  })
})

// Modifier ses infos (client uniquement, pas de JWT)
router.put('/:id/infos', async (req, res) => {
  const { id } = req.params
  const { prenom, nom, telephone, email } = req.body

  const { data: client } = await supabase.from('clients').select('id').eq('id', id).single()
  if (!client) return res.status(404).json({ error: 'Client introuvable' })

  const { data, error } = await supabase
    .from('clients')
    .update({ prenom, nom, telephone, email })
    .eq('id', id)
    .select().single()

  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
})

// Tous les passages (historique complet)
router.get('/:id/passages', async (req, res) => {
  const { id } = req.params
  const { data, error } = await supabase
    .from('passages')
    .select('*')
    .eq('client_id', id)
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.get('/:id', async (req, res) => {
  const { id } = req.params

  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .single()

  if (clientErr || !client) return res.status(404).json({ error: 'Client introuvable' })

  const { data: commercant, error: cErr } = await supabase
    .from('commercants')
    .select('nom_enseigne, type_activite, emoji, couleur, pts_par_passage, seuil_reward, reward_desc, icon_url, mode_points, euro_to_points, parrainage_actif, reward_expiry_days, points_expiry_days')
    .eq('id', client.commercant_id)
    .single()

  if (cErr) return res.status(500).json({ error: cErr.message })

  const [{ data: passages, error: pErr }, { data: paliers }] = await Promise.all([
    supabase.from('passages').select('*').eq('client_id', id).order('created_at', { ascending: false }).limit(10),
    supabase.from('paliers').select('*').eq('commercant_id', client.commercant_id).order('points_requis')
  ])

  if (pErr) return res.status(500).json({ error: pErr.message })

  res.json({ client, commercant, passages, paliers: paliers || [] })
})

module.exports = router
