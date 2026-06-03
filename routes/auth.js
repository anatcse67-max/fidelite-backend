const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const supabase = require('../lib/supabase')

const router = express.Router()

router.post('/register', async (req, res) => {
  const { email, password, nom_enseigne, type_activite, emoji, couleur, pts_par_passage, seuil_reward, reward_desc } = req.body

  if (!email || !password || !nom_enseigne) {
    return res.status(400).json({ error: 'email, password et nom_enseigne sont requis' })
  }

  const hash = await bcrypt.hash(password, 10)

  const { data, error } = await supabase
    .from('commercants')
    .insert([{ email, password: hash, nom_enseigne, type_activite, emoji, couleur, pts_par_passage, seuil_reward, reward_desc }])
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })

  const token = jwt.sign({ id: data.id, email: data.email }, process.env.JWT_SECRET, { expiresIn: '30d' })
  res.json({ token, commercant: data })
})

router.post('/login', async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'email et password sont requis' })
  }

  const { data, error } = await supabase
    .from('commercants')
    .select('*')
    .eq('email', email)
    .single()

  if (error || !data) return res.status(401).json({ error: 'Identifiants invalides' })

  const valid = await bcrypt.compare(password, data.password)
  if (!valid) return res.status(401).json({ error: 'Identifiants invalides' })

  const token = jwt.sign({ id: data.id, email: data.email }, process.env.JWT_SECRET, { expiresIn: '30d' })
  res.json({ token, commercant: data })
})

module.exports = router
