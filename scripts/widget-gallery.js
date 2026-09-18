#!/usr/bin/env node
'use strict';

// Shows every state of the delivery widget in a browser, without a Homey: the
// widget's own page, fed the payloads in test/support/widgetstates.js by a
// stand-in for the Homey object, on a page that lays them out in both widths
// and both themes. For looking at the widget while working on it:
//
//   make gallery          (or: node scripts/widget-gallery.js)
//
// then open the address it prints. Edit widgets/delivery/public/index.html or
// the states and reload. PORT picks another port.

const fs = require('fs');
const http = require('http');
const path = require('path');
const { widgetStates } = require('../test/support/widgetstates.js');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'widgets', 'delivery', 'public');
const PORT = Number(process.env.PORT) || 8770;

// The Homey style variables the widget reads, with the values a dashboard
// gives them, as far as they are known; the widget has a fallback for each.
const THEMES = {
  light: "--homey-text-color:#1b1b1d;--homey-text-color-light:#86868b;--homey-background-color:#ffffff;",
  dark: "--homey-text-color:#f2f2f4;--homey-text-color-light:#8e8e93;--homey-background-color:#1c1c1e;"
};

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function page() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Delivery widget, every state</title>
<style>
  body { margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #c9c9d0; color: #1b1b1d; }
  header { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; margin-bottom: 20px; font-size: 14px; }
  header label { display: inline-flex; gap: 6px; align-items: center; }
  .theme { padding: 16px; border-radius: 16px; margin-bottom: 20px; }
  .light { background: #eceff3; }
  .dark { background: #0d0d0e; color: #eee; }
  .theme h2 { margin: 0 0 12px; font-size: 13px; font-weight: 600; opacity: .6; }
  .grid { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
  figure { margin: 0; }
  figcaption { font-size: 11px; opacity: .6; margin-top: 4px; max-width: 358px; }
  iframe { display: block; border: 0; border-radius: 18px; height: 188px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .dark iframe { background: #1c1c1e; }
  pre { display: none; font-size: 11px; white-space: pre-wrap; max-width: 358px; }
  figure.open pre { display: block; }
</style>
</head>
<body>
<header>
  <strong>Delivery widget</strong>
  <label>language <select id="lang"><option value="nl">nl</option><option value="en">en</option></select></label>
  <label>width <select id="width"><option value="358">full (358 px)</option><option value="171">half (171 px)</option><option value="both">both</option></select></label>
  <label>theme <select id="theme"><option value="both">both</option><option value="light">light</option><option value="dark">dark</option></select></label>
  <span style="opacity:.6">click a tile's caption for its payload</span>
</header>
<div id="galleries"></div>
<script>
const THEMES = ${JSON.stringify(THEMES)};
const controls = { lang: document.getElementById('lang'), width: document.getElementById('width'), theme: document.getElementById('theme') };
const query = new URLSearchParams(location.search);
for (const key in controls) { if (query.get(key)) controls[key].value = query.get(key); controls[key].addEventListener('change', build); }

async function build() {
  const params = new URLSearchParams(Object.fromEntries(Object.entries(controls).map(([k, c]) => [k, c.value])));
  history.replaceState(null, '', '?' + params);
  const states = await fetch('/states.json?lang=' + controls.lang.value).then(r => r.json());
  const themes = controls.theme.value == 'both' ? ['light', 'dark'] : [controls.theme.value];
  const widths = controls.width.value == 'both' ? [358, 171] : [Number(controls.width.value)];
  const galleries = document.getElementById('galleries');
  galleries.textContent = '';

  for (const theme of themes) {
    for (const width of widths) {
      const section = document.createElement('div');
      section.className = 'theme ' + theme;
      section.innerHTML = '<h2>' + theme + ' · ' + width + ' px</h2><div class="grid"></div>';
      const grid = section.querySelector('.grid');

      for (const id in states) {
        const figure = document.createElement('figure');
        const frame = document.createElement('iframe');
        frame.style.width = width + 'px';
        frame.title = id;
        frame.src = '/widget/index.html';
        frame.addEventListener('load', () => mount(frame, theme, states[id].payload));
        const caption = document.createElement('figcaption');
        caption.textContent = id + ' — ' + states[id].title;
        caption.addEventListener('click', () => figure.classList.toggle('open'));
        const dump = document.createElement('pre');
        dump.textContent = JSON.stringify(Object.assign({}, states[id].payload, { labels: '…' }), null, 1);
        figure.append(frame, caption, dump);
        grid.append(figure);
      }

      galleries.append(section);
    }
  }
}

// What Homey does to the widget's page before the widget's own script runs:
// the style variables, the dark mode class, and the Homey object.
function mount(frame, theme, payload) {
  const doc = frame.contentDocument;
  if (theme == 'dark') doc.body.classList.add('homey-dark-mode');
  doc.documentElement.style.cssText = THEMES[theme] + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--homey-text-color);background:var(--homey-background-color)';
  frame.contentWindow.onHomeyReady({
    getSettings: () => ({}),
    on() { },
    ready() { },
    api: () => Promise.resolve(payload)
  });
}

build();
</script>
</body>
</html>`;
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');

  if (url.pathname == '/') {
    response.writeHead(200, { 'Content-Type': TYPES['.html'] });
    return response.end(page());
  }

  if (url.pathname == '/states.json') {
    response.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
    return response.end(JSON.stringify(widgetStates(url.searchParams.get('lang') == 'en' ? 'en' : 'nl')));
  }

  if (url.pathname.startsWith('/widget/')) {
    const file = path.normalize(path.join(PUBLIC, url.pathname.slice('/widget/'.length)));

    if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      return fs.createReadStream(file).pipe(response);
    }
  }

  response.writeHead(404);
  response.end('not here');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('The widget gallery is at http://127.0.0.1:' + PORT + '/ (stop it with ctrl-c)');
});
