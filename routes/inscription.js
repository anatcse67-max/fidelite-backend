const express = require('express')
const supabase = require('../lib/supabase')

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
    .select('id, nom_enseigne, type_activite, emoji, couleur, pts_par_passage, seuil_reward, reward_desc')
    .eq('id', req.params.commercant_id)
    .single()

  if (error || !data) return res.status(404).json({ error: 'Enseigne introuvable' })
  res.json(data)
})

// Inscription d'un nouveau client
router.post('/:commercant_id', async (req, res) => {
  const { prenom, nom, telephone, email } = req.body
  const { commercant_id } = req.params

  if (!prenom) return res.status(400).json({ error: 'Le prénom est requis' })

  const { data: commercant } = await supabase
    .from('commercants')
    .select('id')
    .eq('id', commercant_id)
    .single()

  if (!commercant) return res.status(404).json({ error: 'Enseigne introuvable' })

  let id, exists
  do {
    id = generateId()
    const { data } = await supabase.from('clients').select('id').eq('id', id).single()
    exists = !!data
  } while (exists)

  const { data, error } = await supabase
    .from('clients')
    .insert([{ id, commercant_id, prenom, nom, telephone, email }])
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.status(201).json(data)
})

module.exports = router
