const express = require('express')
const { Template } = require('@walletpass/pass-js')
const fs = require('fs')
const path = require('path')
const supabase = require('../lib/supabase')

const router = express.Router()

const PASS_TYPE_ID = 'pass.com.fidelite.carte'
const TEAM_ID = process.env.APPLE_TEAM_ID || '8N87Y49897'

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return 'rgb(108, 99, 255)'
  return `rgb(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)})`
}

async function generatePass(client, commercant, totalPassages) {
  const passesDir = path.join(__dirname, '..', 'passes')
  const templateDir = path.join(passesDir, 'template')

  const couleur = commercant.couleur || '#6c63ff'
  const seuil = commercant.seuil_reward || 10
  const points = client.points || 0
  const rewardDesc = commercant.reward_desc || 'Récompense'
  const nomEnseigne = commercant.nom_enseigne || 'Fidélité'

  // Créer le template
  const template = new Template('storeCard', {
    passTypeIdentifier: PASS_TYPE_ID,
    teamIdentifier: TEAM_ID,
    organizationName: nomEnseigne,
    description: `Carte fidélité ${nomEnseigne}`,
    foregroundColor: 'rgb(255, 255, 255)',
    backgroundColor: hexToRgb(couleur),
    labelColor: 'rgb(255, 255, 255)',
    logoText: nomEnseigne,
  })

  // Charger les certificats
  template.setCertificate(fs.readFileSync(path.join(passesDir, 'pass-cert.pem')).toString())
  template.setPrivateKey(fs.readFileSync(path.join(passesDir, 'pass-key.pem')).toString())

  // Ajouter les icônes
  await template.images.add('icon', fs.readFileSync(path.join(templateDir, 'icon.png')), '1x')
  await template.images.add('icon', fs.readFileSync(path.join(templateDir, 'icon@2x.png')), '2x')
  await template.images.add('logo', fs.readFileSync(path.join(templateDir, 'logo.png')), '1x')
  await template.images.add('logo', fs.readFileSync(path.join(templateDir, 'logo@2x.png')), '2x')

  // Créer le pass
  const pass = template.createPass({
    serialNumber: `${client.id}-${Date.now()}`,
    description: `Carte fidélité ${nomEnseigne}`,
    storeCard: {
      primaryFields: [
        {
          key: 'points',
          label: 'POINTS',
          value: `${points} / ${seuil}`,
          textAlignment: 'PKTextAlignmentCenter',
        },
      ],
      secondaryFields: [
        {
          key: 'nom',
          label: 'CLIENT',
          value: `${client.prenom || ''} ${client.nom || ''}`.trim(),
        },
        {
          key: 'reward',
          label: 'RÉCOMPENSE',
          value: rewardDesc,
        },
      ],
      auxiliaryFields: [
        {
          key: 'passages',
          label: 'PASSAGES',
          value: String(totalPassages || 0),
        },
        {
          key: 'id',
          label: 'ID CARTE',
          value: client.id,
        },
      ],
      backFields: [
        {
          key: 'info',
          label: 'Programme de fidélité',
          value: `Gagnez des points à chaque visite chez ${nomEnseigne}.\nÀ partir de ${seuil} points : ${rewardDesc}`,
        },
      ],
    },
    barcodes: [
      {
        message: client.id,
        format: 'PKBarcodeFormatQR',
        messageEncoding: 'iso-8859-1',
        altText: client.id,
      },
    ],
  })

  return pass.asBuffer()
}

// GET /wallet/:clientId
router.get('/:clientId', async (req, res) => {
  const { clientId } = req.params

  const { data: client, error: cErr } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single()

  if (cErr || !client) return res.status(404).json({ error: 'Client introuvable' })

  const { data: commercant } = await supabase
    .from('commercants')
    .select('nom_enseigne, emoji, couleur, seuil_reward, reward_desc')
    .eq('id', client.commercant_id)
    .single()

  const { count: totalPassages } = await supabase
    .from('passages')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)

  try {
    const pkpassBuffer = await generatePass(client, commercant || {}, totalPassages)
    res.setHeader('Content-Type', 'application/vnd.apple.pkpass')
    res.setHeader('Content-Disposition', `attachment; filename="fidelite-${clientId}.pkpass"`)
    res.send(pkpassBuffer)
  } catch (err) {
    console.error('Wallet error:', err.message, err.stack)
    res.status(500).json({ error: 'Erreur génération pass: ' + err.message })
  }
})

module.exports = router
