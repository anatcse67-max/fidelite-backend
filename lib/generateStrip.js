const zlib = require('zlib')

// Créer un PNG depuis des pixels RGB bruts
function buildPNG(width, height, getPixel) {
  const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  const table = Array.from({ length: 256 }, (_, i) => {
    let c = i
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    return c
  })
  function crc32(buf) {
    let crc = 0xFFFFFFFF
    for (const b of buf) crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8)
    return (crc ^ 0xFFFFFFFF) >>> 0
  }
  function chunk(type, data) {
    const t = Buffer.from(type)
    const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length)
    const crcBuf = Buffer.allocUnsafe(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])))
    return Buffer.concat([len, t, data, crcBuf])
  }

  const ihdr = Buffer.allocUnsafe(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

  const raw = Buffer.allocUnsafe(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    for (let x = 0; x < width; x++) {
      const [r, g, b] = getPixel(x, y, width, height)
      const i = y * (width * 3 + 1) + 1 + x * 3
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b
    }
  }
  const compressed = zlib.deflateSync(raw)
  return Buffer.concat([PNG_HEADER, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))])
}

function hexToRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return r ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)] : [108, 99, 255]
}

function lighten(rgb, factor = 0.3) {
  return rgb.map(c => Math.min(255, Math.round(c + (255 - c) * factor)))
}

function darken(rgb, factor = 0.3) {
  return rgb.map(c => Math.round(c * (1 - factor)))
}

// Style BARRES — barre de progression
function generateBarres(points, seuil, couleur, W = 312, H = 144) {
  const bg = hexToRgb(couleur)
  const bgDark = darken(bg, 0.2)
  const filled = hexToRgb('#ffffff')
  const empty = lighten(bg, 0.25)

  const margin = 30
  const barH = 32
  const barW = W - margin * 2
  const barY = H / 2 - barH / 2
  const radius = barH / 2
  const progress = Math.min(1, points / seuil)
  const fillW = Math.round(barW * progress)

  return buildPNG(W, H, (x, y) => {
    // Fond dégradé
    const t = x / W
    const bg2 = bg.map((c, i) => Math.round(c * (1 - t * 0.15) + bgDark[i] * t * 0.15))

    // Barre fond (arrondie)
    const inBarBg = x >= margin && x <= margin + barW && y >= barY && y <= barY + barH
    if (inBarBg) {
      const lx = x - margin, ly = y - barY
      // Arrondir coins
      if (lx < radius && ly < radius && Math.hypot(lx - radius, ly - radius) > radius) return empty
      if (lx < radius && ly > barH - radius && Math.hypot(lx - radius, ly - (barH - radius)) > radius) return empty
      if (lx > barW - radius && ly < radius && Math.hypot(lx - (barW - radius), ly - radius) > radius) return empty
      if (lx > barW - radius && ly > barH - radius && Math.hypot(lx - (barW - radius), ly - (barH - radius)) > radius) return empty

      // Remplissage
      if (fillW > 0 && lx <= fillW) {
        if (lx < radius && ly < radius && Math.hypot(lx - radius, ly - radius) > radius) return empty
        if (lx < radius && ly > barH - radius && Math.hypot(lx - radius, ly - (barH - radius)) > radius) return empty
        return filled
      }
      return empty
    }

    // Texte simulé (points en haut à droite)
    return bg2
  })
}

// Style TAMPONS — cercles
function generateTampons(points, seuil, couleur, W = 312, H = 144) {
  const bg = hexToRgb(couleur)
  const filled = [255, 255, 255]
  const empty = lighten(bg, 0.25)
  const border = lighten(bg, 0.4)

  // Calculer disposition des tampons
  const n = Math.min(seuil, 20) // max 20 tampons affichés
  const cols = Math.min(n, 10)
  const rows = Math.ceil(n / cols)
  const r = Math.min(22, (W - 60) / (cols * 2.5), (H - 40) / (rows * 2.5))
  const spacingX = (W - 60) / cols
  const spacingY = (H - 40) / rows

  return buildPNG(W, H, (x, y) => {
    const bgDark = darken(bg, 0.15)
    const t = y / H
    const bgPx = bg.map((c, i) => Math.round(c * (1 - t * 0.1) + bgDark[i] * t * 0.1))

    for (let i = 0; i < n; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const cx = 30 + spacingX * col + spacingX / 2
      const cy = 20 + spacingY * row + spacingY / 2
      const dist = Math.hypot(x - cx, y - cy)

      if (dist <= r + 2) {
        if (dist > r) return border
        return i < points ? filled : empty
      }
    }
    return bgPx
  })
}

// Style ETOILES
function generateEtoiles(points, seuil, couleur, W = 312, H = 144) {
  const bg = hexToRgb(couleur)
  const filled = [255, 220, 50]
  const empty = lighten(bg, 0.2)

  const n = Math.min(seuil, 15)
  const cols = Math.min(n, 8)
  const rows = Math.ceil(n / cols)
  const size = Math.min(28, (W - 60) / (cols * 1.8))
  const spacingX = (W - 60) / cols
  const spacingY = (H - 40) / rows

  function inStar(px, py, cx, cy, outerR, innerR) {
    const dx = px - cx, dy = py - cy
    const angle = Math.atan2(dy, dx) - Math.PI / 2
    const dist = Math.hypot(dx, dy)
    const spike = 5
    const section = Math.floor((angle / (2 * Math.PI)) * spike * 2 + spike * 2) % 2
    const r = section === 0 ? outerR : innerR
    return dist <= r
  }

  return buildPNG(W, H, (x, y) => {
    const bgDark = darken(bg, 0.1)
    const t = x / W
    const bgPx = bg.map((c, i) => Math.round(c * (1 - t * 0.08) + bgDark[i] * t * 0.08))

    for (let i = 0; i < n; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const cx = 30 + spacingX * col + spacingX / 2
      const cy = 20 + spacingY * row + spacingY / 2

      if (inStar(x, y, cx, cy, size, size * 0.45)) {
        return i < points ? filled : empty
      }
    }
    return bgPx
  })
}

module.exports = { generateBarres, generateTampons, generateEtoiles }
