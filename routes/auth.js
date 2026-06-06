const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { Resend } = require('resend')
const multer = require('multer')
const supabase = require('../lib/supabase')

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } })

const router = express.Router()
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

function authMiddleware(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Token manquant' })
  try {
    req.commercant = jwt.verify(header.slice(7), process.env.JWT_SECRET)
    next()
  } catch { res.status(401).json({ error: 'Token invalide' }) }
}

router.post('/register', async (req, res) => {
  const { email, password, nom_enseigne, type_activite, emoji, couleur, pts_par_passage, seuil_reward, reward_desc, register_code } = req.body

  const validCode = process.env.REGISTER_CODE
  if (validCode && register_code !== validCode) {
    return res.status(403).json({ error: 'Code d\'accès invalide' })
  }

  if (!email || !password || !nom_enseigne) {
    return res.status(400).json({ error: 'email, password et nom_enseigne sont requis' })
  }

  const hash = await bcrypt.hash(password, 10)
  const { data, error } = await supabase
    .from('commercants')
    .insert([{ email, password: hash, nom_enseigne, type_activite, emoji, couleur, pts_par_passage, seuil_reward, reward_desc }])
    .select().single()

  if (error) return res.status(400).json({ error: error.message })

  const token = jwt.sign({ id: data.id, email: data.email }, process.env.JWT_SECRET, { expiresIn: '30d' })
  res.json({ token, commercant: data })
})

router.post('/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'email et password sont requis' })

  const { data, error } = await supabase.from('commercants').select('*').eq('email', email).single()
  if (error || !data) return res.status(401).json({ error: 'Identifiants invalides' })

  const valid = await bcrypt.compare(password, data.password)
  if (!valid) return res.status(401).json({ error: 'Identifiants invalides' })

  const token = jwt.sign({ id: data.id, email: data.email }, process.env.JWT_SECRET, { expiresIn: '30d' })
  res.json({ token, commercant: data })
})

// Modifier le profil
router.put('/profile', authMiddleware, async (req, res) => {
  const { nom_enseigne, type_activite, emoji, couleur, pts_par_passage, seuil_reward, reward_desc,
    mode_points, euro_to_points, parrainage_actif, parrainage_points, parrainage_nb_min } = req.body

  const { data, error } = await supabase
    .from('commercants')
    .update({ nom_enseigne, type_activite, emoji, couleur, pts_par_passage, seuil_reward, reward_desc,
      mode_points, euro_to_points, parrainage_actif, parrainage_points, parrainage_nb_min })
    .eq('id', req.commercant.id)
    .select().single()

  if (error) return res.status(400).json({ error: error.message })
  res.json({ commercant: data })
})

// Changer le mot de passe
router.put('/password', authMiddleware, async (req, res) => {
  const { current_password, new_password } = req.body
  if (!current_password || !new_password) return res.status(400).json({ error: 'Champs requis' })

  const { data } = await supabase.from('commercants').select('password').eq('id', req.commercant.id).single()
  const valid = await bcrypt.compare(current_password, data.password)
  if (!valid) return res.status(401).json({ error: 'Mot de passe actuel incorrect' })

  const hash = await bcrypt.hash(new_password, 10)
  await supabase.from('commercants').update({ password: hash }).eq('id', req.commercant.id)
  res.json({ success: true })
})

// Mot de passe oublié
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body
  const { data } = await supabase.from('commercants').select('id, nom_enseigne').eq('email', email).single()
  if (!data) return res.json({ success: true }) // Ne pas révéler si l'email existe

  const token = jwt.sign({ id: data.id, email }, process.env.JWT_SECRET, { expiresIn: '1h' })
  const resetUrl = `${process.env.DASHBOARD_URL}/reset-password?token=${token}`

  if (resend) {
    await resend.emails.send({
      from: 'Fidélité <noreply@resend.dev>',
      to: email,
      subject: 'Réinitialisation de votre mot de passe',
      html: `<div style="font-family:sans-serif;max-width:500px;margin:auto;padding:32px">
        <h2 style="color:#4f46e5">Réinitialisation du mot de passe</h2>
        <p>Bonjour ${data.nom_enseigne},</p>
        <p style="margin:16px 0">Cliquez sur le bouton ci-dessous pour réinitialiser votre mot de passe. Ce lien expire dans 1 heure.</p>
        <a href="${resetUrl}" style="background:#4f46e5;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">
          Réinitialiser mon mot de passe
        </a>
        <p style="margin-top:24px;color:#999;font-size:13px">Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.</p>
      </div>`
    })
  }

  res.json({ success: true })
})

// Réinitialiser le mot de passe avec token
router.post('/reset-password', async (req, res) => {
  const { token, new_password } = req.body
  try {
    const { id } = jwt.verify(token, process.env.JWT_SECRET)
    const hash = await bcrypt.hash(new_password, 10)
    await supabase.from('commercants').update({ password: hash }).eq('id', id)
    res.json({ success: true })
  } catch {
    res.status(400).json({ error: 'Lien invalide ou expiré' })
  }
})

// Upload icône commerçant
router.post('/upload-icon', authMiddleware, upload.single('icon'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier envoyé' })

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  if (!allowed.includes(req.file.mimetype)) {
    return res.status(400).json({ error: 'Format non supporté (JPG, PNG, WEBP, GIF uniquement)' })
  }

  const ext = req.file.originalname.split('.').pop()
  const fileName = `${req.commercant.id}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('icons')
    .upload(fileName, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: true
    })

  if (uploadError) return res.status(500).json({ error: uploadError.message })

  const { data: { publicUrl } } = supabase.storage.from('icons').getPublicUrl(fileName)

  const { data, error } = await supabase
    .from('commercants')
    .update({ icon_url: publicUrl })
    .eq('id', req.commercant.id)
    .select().single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ commercant: data, icon_url: publicUrl })
})

module.exports = router
