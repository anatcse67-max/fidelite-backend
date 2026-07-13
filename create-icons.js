const fs = require('fs');
const path = require('path');

// PNG minimaliste 1x1 pixel violet (#6c63ff) - on va créer un PNG valide
// En fait on va créer un PNG 58x58 simple
const { createCanvas } = (() => { try { return require('canvas'); } catch(e) { return null; } })() || {};

// Fallback: utiliser un PNG violet minimal encodé en base64
// PNG 1x1 violet #6c63ff
const png1x1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
  '2e00000000c4944415478016360f8cfc0000000200016b02de200000000049454e44ae426082',
  'hex'
);

const templateDir = path.join(__dirname, 'passes', 'template');
fs.mkdirSync(templateDir, { recursive: true });

// Écrire les icônes requises (même fichier pour toutes les tailles)
['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png', 'strip.png', 'strip@2x.png'].forEach(f => {
  fs.writeFileSync(path.join(templateDir, f), png1x1);
});
console.log('Icônes créées');
