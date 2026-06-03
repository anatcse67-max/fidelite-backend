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
    .select('nom_enseigne, emoji, couleur')
    .eq('id', client.commercant_id)
    .single()

  const origin = process.env.DASHBOARD_URL || 'https://fidelite-dashboard-kohl.vercel.app'

  res.setHeader('Content-Type', 'application/json')
  res.json({
    name: commercant ? `${commercant.emoji} ${commercant.nom_enseigne}` : 'Carte fidélité',
    short_name: commercant?.nom_enseigne || 'Fidélité',
    start_url: `${origin}/carte/${id}`,
    display: 'standalone',
    background_color: commercant?.couleur || '#6c63ff',
    theme_color: commercant?.couleur || '#6c63ff',
    icons: [
      { src: `${origin}/icon-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${origin}/icon-512.png`, sizes: '512x512', type: 'image/png' }
    ]
  })
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
    .select('nom_enseigne, type_activite, emoji, couleur, pts_par_passage, seuil_reward, reward_desc')
    .eq('id', client.commercant_id)
    .single()

  if (cErr) return res.status(500).json({ error: cErr.message })

  const { data: passages, error: pErr } = await supabase
    .from('passages')
    .select('*')
    .eq('client_id', id)
    .order('created_at', { ascending: false })
    .limit(10)

  if (pErr) return res.status(500).json({ error: pErr.message })

  res.json({ client, commercant, passages })
})

module.exports = router
