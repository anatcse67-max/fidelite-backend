const express = require('express')
const supabase = require('../lib/supabase')

const router = express.Router()

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
