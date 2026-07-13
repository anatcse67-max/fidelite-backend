const http2 = require('http2')
const fs = require('fs')
const path = require('path')

const passesDir = path.join(__dirname, '..', 'passes')
const PASS_TYPE_ID = 'pass.com.fidelite.carte'
// Production: api.push.apple.com / Sandbox: api.sandbox.push.apple.com
const APNS_HOST = 'api.push.apple.com'

async function sendWalletPush(pushToken) {
  return new Promise((resolve, reject) => {
    let client
    try {
      client = http2.connect(`https://${APNS_HOST}`, {
        cert: fs.readFileSync(path.join(passesDir, 'pass-cert.pem')),
        key: fs.readFileSync(path.join(passesDir, 'pass-key.pem')),
      })
    } catch (e) {
      return reject(e)
    }

    const timeout = setTimeout(() => {
      try { client.close() } catch (_) {}
      reject(new Error('APNs timeout'))
    }, 10000)

    client.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    const body = '{}'
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${pushToken}`,
      'apns-topic': PASS_TYPE_ID,
      'apns-push-type': 'background',
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    })

    req.on('response', (headers) => {
      clearTimeout(timeout)
      const status = headers[':status']
      console.log(`📲 APNs push → ${status} (token: ${pushToken.substring(0, 10)}...)`)
      try { client.close() } catch (_) {}
      resolve(status)
    })

    req.on('error', (err) => {
      clearTimeout(timeout)
      try { client.close() } catch (_) {}
      reject(err)
    })

    req.end(body)
  })
}

module.exports = { sendWalletPush }
