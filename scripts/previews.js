#!/usr/bin/env node
'use strict';

// Draws widgets/delivery/preview-light.png and preview-dark.png, the pictures
// of the widget in the App Store and in the widget picker, the way Homey's
// preview template does: the widget's own frame with the template's soft
// shadow on a transparent 1024x1024 canvas, and inside it the shape of the
// widget with nothing written on it. No text, simple shapes, few colours; the
// one exception to "no text" is Picnic's mark, which is the widget's icon.
//
//   make previews         (or: node scripts/previews.js)
//
// Needs rsvg-convert (librsvg): brew install librsvg.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'widgets', 'delivery');

// Picnic's mark: the letters of the app icon, the same file the widget uses
const icon = fs.readFileSync(path.join(ROOT, 'assets', 'icon.svg'), 'utf8');
const MARK = icon.match(/<path[\s\S]*?\/>/g).map(p => p.replace(/\s+/g, ' ')).join('');

const THEMES = {
  light: { card: '#ffffff', shadow: 0.16, line: '#ececf3', headline: '#d9d9e3', good: '#4b7f24', tint: '#e4ece0' },
  dark: { card: '#2a2a2e', shadow: 0.45, line: '#3a3a40', headline: '#4a4a52', good: '#8bcf5c', tint: '#3a4a34' }
};

// The frame is 800x440, the widget's own 358x188 scaled up by 2.23.
function svg(theme) {
  const t = THEMES[theme];
  const bar = (x, y, w, h, fill, r) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r === undefined ? h / 2 : r}" fill="${fill}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="22"/>
    <feOffset dy="16" result="blur"/>
    <feComponentTransfer><feFuncA type="linear" slope="${t.shadow}"/></feComponentTransfer>
    <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>
${bar(112, 292, 800, 440, t.card, 44).replace('/>', ' filter="url(#shadow)"/>')}
${bar(148, 328, 64, 64, '#e40613', 18)}
<g transform="translate(157 337) scale(0.0324)" fill="#ffffff">${MARK}</g>
${bar(228, 340, 200, 44, t.tint, 12)}
${bar(246, 354, 16, 16, t.good, 4)}
${bar(272, 354, 136, 16, t.good)}
${bar(676, 344, 200, 36, t.line)}
${bar(148, 512, 400, 68, t.headline)}
${bar(148, 604, 300, 32, t.line)}
${bar(148, 668, 728, 24, t.line)}
${bar(148, 668, 452, 24, t.good)}
</svg>
`;
}

function main() {
  try {
    execFileSync('rsvg-convert', ['--version'], { stdio: 'ignore' });
  } catch (exception) {
    console.error('rsvg-convert is not installed; on a Mac: brew install librsvg');
    process.exit(1);
  }

  for (const theme of Object.keys(THEMES)) {
    const file = path.join(OUT, 'preview-' + theme + '.png');
    execFileSync('rsvg-convert', ['--width', '1024', '--height', '1024', '--format', 'png', '--output', file], { input: svg(theme) });
    console.log('drawn ' + path.relative(ROOT, file));
  }
}

main();
