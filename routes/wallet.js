const express = require('express')
const { PKPass } = require('@walletpass/pass-js')
const fs = require('fs')
const path = require('path')
const supabase = require('../lib/supabase')

const router = express.Router()

const PASS_TYPE_ID = 'pass.com.fidelite.carte'
const TEAM_ID = process.env.APPLE_TEAM_ID || '8N87Y49897'

async function generatePass(client, commercant, totalPassages) {
  const passesDir = path.join(__dirname, '..', 'passes')
  const templateDir = path.join(passesDir, 'template')

  const p12 = fs.readFileSync(path.join(passesDir, 'pass.p12'))
  const wwdr = fs.readFileSync(path.join(passesDir, 'wwdr.pem'))

  const couleur = commercant.couleur || '#6c63ff'

  // Calcul de la progression
  const seuil = commercant.seuil_reward || 10
  const points = client.points || 0
  const progress = Math.min(points, seuil)
  const rewardDesc = commercant.reward_desc || 'Récompense'
  const nomEnseigne = commercant.nom_enseigne || 'Fidélité'

  const pass = new PKPass(
    {
      // Fichiers du template (icônes)
      'icon.png': fs.readFileSync(path.join(templateDir, 'icon.png')),
      'icon@2x.png': fs.readFileSync(path.join(templateDir, 'icon@2x.png')),
      'logo.png': fs.readFileSync(path.join(templateDir, 'logo.png')),
      'logo@2x.png': fs.readFileSync(path.join(templateDir, 'logo@2x.png')),
    },
    {
      // Certificat de signature
      signerCert: wwdr,
      signerKey: p12,
      signerKeyPassphrase: 'fidelite2024',
      wwdr: wwdr,
    },
    {
      // Métadonnées du pass
      formatVersion: 1,
      passTypeIdentifier: PASS_TYPE_ID,
      serialNumber: `${client.id}-${Date.now()}`,
      teamIdentifier: TEAM_ID,
      organizationName: nomEnseigne,
      description: `Carte fidélité ${nomEnseigne}`,
      logoText: nomEnseigne,
      foregroundColor: 'rgb(255, 255, 255)',
      backgroundColor: hexToRgb(couleur),
      labelColor: 'rgb(255, 255, 255)',

      // Type de pass : storeCard
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
          {
            key: 'id_back',
            label: 'Identifiant',
            value: client.id,
          },
        ],
      },

      barcode: {
        message: client.id,
        format: 'PKBarcodeFormatQR',
        messageEncoding: 'iso-8859-1',
        altText: client.id,
      },

      barcodes: [
        {
          message: client.id,
          format: 'PKBarcodeFormatQR',
          messageEncoding: 'iso-8859-1',
          altText: client.id,
        },
      ],
    }
  )

  return pass.getAsBuffer()
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return 'rgb(108, 99, 255)'
  return `rgb(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)})`
}

// GET /wallet/:clientId — génère et télécharge le .pkpass
router.get('/:clientId', async (req, res) => {
  const { clientId } = req.params

  const { data: client, error: cErr } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single()

  if (cErr || !client) return res.status(404).json({ error: 'Client introuvable' })

  const { data: commercant, error: coErr } = await supabase
    .from('commercants')
    .select('nom_enseigne, emoji, couleur, pts_par_passage, seuil_reward, reward_desc, mode_points, euro_to_points')
    .eq('id', client.commercant_id)
    .single()

  if (coErr) return res.status(500).json({ error: coErr.message })

  const { count: totalPassages } = await supabase
    .from('passages')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)

  try {
    const pkpassBuffer = await generatePass(client, commercant, totalPassages)

    res.setHeader('Content-Type', 'application/vnd.apple.pkpass')
    res.setHeader('Content-Disposition', `attachment; filename="fidelite-${clientId}.pkpass"`)
    res.send(pkpassBuffer)
  } catch (err) {
    console.error('Wallet generation error:', err)
    res.status(500).json({ error: 'Erreur génération du pass: ' + err.message })
  }
})

module.exports = router
