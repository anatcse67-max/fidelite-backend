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
  const { prenom, nom, telephone, email, referral_code } = req.body
  const { commercant_id } = req.params

  if (!prenom) return res.status(400).json({ error: 'Le prénom est requis' })

  const { data: commercant } = await supabase
    .from('commercants')
    .select('id, pts_par_passage')
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

  // Bonus parrainage : +2 pts pour le parrain
  if (referred_by) {
    const bonusPts = Math.max(2, commercant.pts_par_passage * 2)
    const { data: parrain } = await supabase.from('clients').select('points').eq('id', referred_by).single()
    if (parrain) {
      await supabase.from('clients').update({ points: parrain.points + bonusPts }).eq('id', referred_by)
      await supabase.from('passages').insert([{
        client_id: referred_by,
        commercant_id,
        points_ajoutes: bonusPts,
        note: `🤝 Parrainage de ${prenom} — bonus ${bonusPts} pts`
      }])
    }
  }

  res.status(201).json({ ...data, parrainage_valide: !!referred_by })
})

module.exports = router
