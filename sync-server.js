/**
 * Local PC Web Studio & LG webOS TV Sync Server
 * Run with: npm run studio (or node sync-server.js)
 * Opens http://localhost:8765 on your PC so you can add multiple M3U URLs,
 * choose which channels appear, set custom channel numbers, and sync in 1 click to your LG TV!
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 8765;
const STATE_FILE = path.join(__dirname, 'lineup-config.json');

function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

function loadSavedState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {}
  return {
    sources: [
      { id: 'src_1', name: 'פלייליסט ראשי', url: 'https://iptv-org.github.io/iptv/countries/il.m3u', enabled: true }
    ],
    overrides: {},
    rawChannels: [],
    compiledChannels: [],
    epgUrl: ''
  };
}

let currentState = loadSavedState();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  // Enable CORS so LG webOS TV can fetch from this PC on the local network
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlPath = req.url.split('?')[0];

  if (urlPath === '/api/info' && req.method === 'GET') {
    const lanIp = getLanIp();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ lanIp: lanIp, syncUrl: 'http://' + lanIp + ':' + PORT + '/api/lineup' }));
    return;
  }

  if (urlPath === '/api/lineup' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(currentState));
    return;
  }

  if (urlPath === '/api/lineup' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        currentState = parsed;
        fs.writeFileSync(STATE_FILE, JSON.stringify(currentState, null, 2), 'utf8');
        const lanIp = getLanIp();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, lanIp: lanIp }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (urlPath === '/merged.m3u' && req.method === 'GET') {
    let m3u = '#EXTM3U\n';
    const list = currentState.compiledChannels || [];
    list.forEach((ch) => {
      m3u +=
        '#EXTINF:-1 tvg-chno="' +
        ch.number +
        '" tvg-id="' +
        (ch.epgId || '') +
        '" tvg-logo="' +
        (ch.logo || '') +
        '" group-title="' +
        (ch.group || 'טלוויזיה חיה') +
        '",' +
        ch.name +
        '\n' +
        ch.url +
        '\n';
    });
    res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl; charset=utf-8' });
    res.end(m3u);
    return;
  }

  // Serve manager.html by default at '/'
  const relFile = urlPath === '/' ? 'manager.html' : urlPath.replace(/^\/+/, '');
  const fullPath = path.join(__dirname, relFile);

  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(fullPath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const lanIp = getLanIp();
  console.log('==============================================================');
  console.log('   📺 IPTV PC Studio & LG webOS Sync Server is Running!');
  console.log('==============================================================');
  console.log('1. פתח בדפדפן במחשב:  http://localhost:' + PORT);
  console.log('2. כתובת להזנה בטלוויזיה (סנכרון מהמחשב):  ' + lanIp);
  console.log('3. קישור M3U ממוזג ישיר: http://' + lanIp + ':' + PORT + '/merged.m3u');
  console.log('==============================================================');
});
