/**
 * Apple Wallet Web Service
 * Endpoints requis par Apple pour les mises à jour automatiques de pass
 * Doc: https://developer.apple.com/library/archive/documentation/PassKit/Reference/PassKit_WebService/WebService.html
 */
const express = require('express')
const supabase = require('../lib/supabase')
const { sendWalletPush } = require('../lib/apns')

const router = express.Router()

function verifyAuth(req, serialNumber) {
  const auth = req.headers['authorization'] || ''
  if (!auth.startsWith('ApplePass ')) return false
  const token = auth.substring(10)
  // Importer getAuthToken depuis wallet.js
  const { getAuthToken } = require('./wallet')
  return token === getAuthToken(serialNumber)
}

// ── 1. Enregistrement appareil ───────────────────────────────────────────────
// POST /v1/devices/:deviceId/registrations/:passTypeId/:serialNumber
router.post('/v1/devices/:deviceId/registrations/:passTypeId/:serialNumber', async (req, res) => {
  const { deviceId, serialNumber } = req.params
  const { pushToken } = req.body

  if (!verifyAuth(req, serialNumber)) return res.status(401).send()
  if (!pushToken) return res.status(400).send()

  const { error, statusCode } = await supabase.from('wallet_registrations').upsert({
    device_library_id: deviceId,
    push_token: pushToken,
    serial_number: serialNumber,
  }, { onConflict: 'device_library_id,serial_number' })

  if (error) {
    console.error('Wallet registration error:', error.message)
    return res.status(500).send()
  }

  console.log(`📱 Appareil enregistré: ${deviceId.substring(0, 8)}... → client ${serialNumber}`)
  res.status(201).send() // 201 = nouveau, 200 = déjà enregistré
})

// ── 2. Désenregistrement ─────────────────────────────────────────────────────
// DELETE /v1/devices/:deviceId/registrations/:passTypeId/:serialNumber
router.delete('/v1/devices/:deviceId/registrations/:passTypeId/:serialNumber', async (req, res) => {
  const { deviceId, serialNumber } = req.params

  if (!verifyAuth(req, serialNumber)) return res.status(401).send()

  await supabase.from('wallet_registrations')
    .delete()
    .eq('device_library_id', deviceId)
    .eq('serial_number', serialNumber)

  res.status(200).send()
})

// ── 3. Passes à mettre à jour pour un appareil ───────────────────────────────
// GET /v1/devices/:deviceId/registrations/:passTypeId
router.get('/v1/devices/:deviceId/registrations/:passTypeId', async (req, res) => {
  const { deviceId } = req.params
  const { passesUpdatedSince } = req.query

  const { data: regs } = await supabase
    .from('wallet_registrations')
    .select('serial_number')
    .eq('device_library_id', deviceId)

  if (!regs || regs.length === 0) return res.status(204).send()

  const serialNumbers = regs.map(r => r.serial_number)

  // Si passesUpdatedSince fourni, filtrer par date de dernière mise à jour
  let filtered = serialNumbers
  if (passesUpdatedSince) {
    const { data: clients } = await supabase
      .from('clients')
      .select('id')
      .in('id', serialNumbers)
      .gt('updated_at', passesUpdatedSince)
    filtered = clients ? clients.map(c => c.id) : []
  }

  if (filtered.length === 0) return res.status(204).send()

  res.json({ serialNumbers: filtered, lastUpdated: new Date().toISOString() })
})

// ── 4. Récupérer le pass mis à jour ─────────────────────────────────────────
// GET /v1/passes/:passTypeId/:serialNumber
router.get('/v1/passes/:passTypeId/:serialNumber', async (req, res) => {
  const { serialNumber } = req.params

  if (!verifyAuth(req, serialNumber)) return res.status(401).send()

  const { data: client } = await supabase.from('clients').select('*').eq('id', serialNumber).single()
  if (!client) return res.status(404).send()

  const { data: commercant } = await supabase
    .from('commercants')
    .select('nom_enseigne, emoji, couleur, seuil_reward, reward_desc, icon_url, pass_style')
    .eq('id', client.commercant_id).single()

  const { count: totalPassages } = await supabase
    .from('passages').select('*', { count: 'exact', head: true }).eq('client_id', serialNumber)

  try {
    const { generatePassBuffer } = require('./wallet')
    const pkpassBuffer = await generatePassBuffer(client, commercant || {}, totalPassages)
    res.setHeader('Content-Type', 'application/vnd.apple.pkpass')
    res.setHeader('Last-Modified', new Date().toUTCString())
    res.send(pkpassBuffer)
  } catch (err) {
    console.error('Wallet update error:', err.message)
    res.status(500).send()
  }
})

// ── 5. Logs Apple ─────────────────────────────────────────────────────────────
// POST /v1/log
router.post('/v1/log', (req, res) => {
  console.log('🍎 Apple Wallet log:', JSON.stringify(req.body))
  res.status(200).send()
})

// ── Fonction utilitaire: push vers tous les appareils d'un client ─────────────
async function pushWalletUpdate(clientId) {
  const { data: regs } = await supabase
    .from('wallet_registrations')
    .select('push_token, device_library_id')
    .eq('serial_number', String(clientId))

  if (!regs || regs.length === 0) return

  for (const reg of regs) {
    try {
      await sendWalletPush(reg.push_token)
    } catch (e) {
      console.warn(`⚠️ APNs push échoué pour ${reg.device_library_id.substring(0, 8)}:`, e.message)
    }
  }
}

module.exports = router
module.exports.pushWalletUpdate = pushWalletUpdate
