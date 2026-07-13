const zlib = require('zlib')

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
function lerp(a, b, t) { return Math.round(a + (b - a) * Math.max(0, Math.min(1, t))) }
function lerpRgb(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)] }
function darken(rgb, f) { return rgb.map(c => Math.max(0, Math.round(c * (1 - f)))) }
function lighten(rgb, f) { return rgb.map(c => Math.min(255, Math.round(c + (255 - c) * f))) }

// Fond dégradé diagonal
function getBg(x, y, W, H, baseColor) {
  const dark = darken(baseColor, 0.35)
  const t = (x / W) * 0.5 + (y / H) * 0.5
  return lerpRgb(baseColor, dark, t)
}

// Cercle antialiasé
function circleAlpha(px, py, cx, cy, r) {
  const d = Math.hypot(px - cx, py - cy)
  return Math.max(0, Math.min(1, r + 0.8 - d))
}

// Blend couleur sur fond
function blend(bg, fg, alpha) {
  return bg.map((c, i) => Math.round(c * (1 - alpha) + fg[i] * alpha))
}

// ─── TAMPONS ─────────────────────────────────────────────────────────────────
function generateTampons(points, seuil, couleur, W = 312, H = 144) {
  const base = hexToRgb(couleur)
  const n = Math.min(seuil, 20)

  // Grille optimale
  const cols = n <= 5 ? n : n <= 10 ? Math.ceil(n / 2) : Math.ceil(n / 3)
  const rows = Math.ceil(n / cols)

  const padX = 18, padY = 16
  const cellW = (W - padX * 2) / cols
  const cellH = (H - padY * 2) / rows
  const r = Math.min(cellW, cellH) * 0.36

  const WHITE = [255, 255, 255]
  const EMPTY_FG = lighten(base, 0.45)
  const GLOW = lighten(base, 0.6)

  return buildPNG(W, H, (x, y) => {
    let px = getBg(x, y, W, H, base)

    for (let i = 0; i < n; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const cx = padX + cellW * col + cellW / 2
      const cy = padY + cellH * row + cellH / 2
      const filled = i < points

      // Halo derrière le tampon rempli
      if (filled) {
        const glowA = Math.max(0, 1 - Math.hypot(x - cx, y - cy) / (r * 2.2)) * 0.35
        if (glowA > 0) px = blend(px, GLOW, glowA)
      }

      // Cercle extérieur (bordure)
      const borderA = circleAlpha(x, y, cx, cy, r)
      if (borderA > 0) {
        if (filled) {
          // Tampon rempli : blanc avec léger dégradé
          const inner = circleAlpha(x, y, cx, cy, r - 1.5)
          const highlight = lighten(WHITE, 0.1)
          const tFill = Math.max(0, (y - (cy - r)) / (r * 2))
          const fgColor = lerpRgb(highlight, WHITE, tFill * 0.3)
          px = blend(px, fgColor, inner * borderA)
        } else {
          // Tampon vide : contour léger + intérieur semi-transparent
          const inner = circleAlpha(x, y, cx, cy, r - 2)
          px = blend(px, WHITE, (borderA - inner) * 0.7) // anneau blanc
          px = blend(px, EMPTY_FG, inner * 0.5)           // intérieur pâle
        }
      }
    }
    return px
  })
}

// ─── BARRES ──────────────────────────────────────────────────────────────────
function generateBarres(points, seuil, couleur, W = 312, H = 144) {
  const base = hexToRgb(couleur)
  const progress = Math.min(1, points / Math.max(1, seuil))

  const barY = H * 0.5
  const barH = H * 0.22
  const barX = W * 0.06
  const barW = W * 0.88
  const radius = barH / 2
  const fillW = barW * progress

  // Segments de progression (un par point)
  const segCount = Math.min(seuil, 20)
  const segGap = 3
  const segW = (barW - (segCount - 1) * segGap) / segCount

  const WHITE = [255, 255, 255]
  const EMPTY = lighten(base, 0.3)
  const FILL_TOP = lighten(WHITE, 0.15)
  const FILL_BOT = WHITE

  return buildPNG(W, H, (x, y) => {
    let px = getBg(x, y, W, H, base)

    // Segments individuels
    for (let i = 0; i < segCount; i++) {
      const sx = barX + i * (segW + segGap)
      const sy = barY - barH / 2
      const sr = Math.min(segW / 2, radius * 0.8)

      // Est-on dans ce segment ?
      if (x >= sx && x <= sx + segW && y >= sy && y <= sy + barH) {
        const lx = x - sx, ly = y - sy

        // Arrondir les coins
        let inSeg = true
        if (lx < sr && ly < sr && Math.hypot(lx - sr, ly - sr) > sr) inSeg = false
        if (lx < sr && ly > barH - sr && Math.hypot(lx - sr, ly - (barH - sr)) > sr) inSeg = false
        if (lx > segW - sr && ly < sr && Math.hypot(lx - (segW - sr), ly - sr) > sr) inSeg = false
        if (lx > segW - sr && ly > barH - sr && Math.hypot(lx - (segW - sr), ly - (barH - sr)) > sr) inSeg = false

        if (inSeg) {
          if (i < points) {
            // Segment rempli : dégradé vertical blanc
            const tV = ly / barH
            const fg = lerpRgb(FILL_TOP, FILL_BOT, tV)
            px = blend(px, fg, 0.95)

            // Reflet haut
            if (ly < barH * 0.35) {
              px = blend(px, WHITE, (1 - ly / (barH * 0.35)) * 0.25)
            }
          } else {
            px = blend(px, EMPTY, 0.55)
          }
        }
      }
    }

    // Indicateur de progression (petit trait brillant au bout)
    if (progress > 0 && progress < 1) {
      const tipX = barX + fillW - 1
      if (Math.abs(x - tipX) < 2 && y > barY - barH / 2 && y < barY + barH / 2) {
        px = blend(px, WHITE, 0.8)
      }
    }

    return px
  })
}

// ─── ÉTOILES ─────────────────────────────────────────────────────────────────
function generateEtoiles(points, seuil, couleur, W = 312, H = 144) {
  const base = hexToRgb(couleur)
  const n = Math.min(seuil, 15)

  const cols = n <= 5 ? n : n <= 10 ? Math.ceil(n / 2) : Math.ceil(n / 3)
  const rows = Math.ceil(n / cols)

  const padX = 20, padY = 16
  const cellW = (W - padX * 2) / cols
  const cellH = (H - padY * 2) / rows
  const outerR = Math.min(cellW, cellH) * 0.38
  const innerR = outerR * 0.42

  const GOLD_TOP = [255, 230, 50]
  const GOLD_BOT = [220, 160, 0]
  const EMPTY = lighten(base, 0.3)
  const GLOW_GOLD = [255, 240, 100]

  function inStar(px, py, cx, cy) {
    const dx = px - cx, dy = py - cy
    const dist = Math.hypot(dx, dy)
    if (dist > outerR + 1.5) return 0
    // 5 pointes : calculer le rayon théorique à cet angle
    const spikes = 5
    const angle = Math.atan2(dy, dx) + Math.PI / 2
    // Normaliser entre 0 et 1 dans un secteur de spike
    const sectorAngle = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    const sectorFrac = (sectorAngle / (2 * Math.PI)) * spikes
    const frac = sectorFrac - Math.floor(sectorFrac)
    // frac 0→0.5 : montée vers pointe, 0.5→1 : descente
    const t = frac < 0.5 ? frac * 2 : (1 - frac) * 2
    const rAtAngle = lerp(outerR, innerR, 1 - t)
    return Math.max(0, Math.min(1, rAtAngle + 1.2 - dist))
  }

  return buildPNG(W, H, (x, y) => {
    let px = getBg(x, y, W, H, base)

    for (let i = 0; i < n; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const cx = padX + cellW * col + cellW / 2
      const cy = padY + cellH * row + cellH / 2
      const filled = i < points

      // Halo doré
      if (filled) {
        const glowA = Math.max(0, 1 - Math.hypot(x - cx, y - cy) / (outerR * 2)) * 0.3
        if (glowA > 0) px = blend(px, GLOW_GOLD, glowA)
      }

      const a = inStar(x, y, cx, cy)
      if (a > 0) {
        if (filled) {
          const tV = Math.max(0, (y - (cy - outerR)) / (outerR * 2))
          const fg = lerpRgb(GOLD_TOP, GOLD_BOT, tV)
          px = blend(px, fg, a)
          // Reflet
          if (y < cy) px = blend(px, [255, 255, 200], a * 0.25)
        } else {
          px = blend(px, EMPTY, a * 0.6)
        }
      }
    }
    return px
  })
}

module.exports = { generateBarres, generateTampons, generateEtoiles }
