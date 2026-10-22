const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
let PORT = Number(process.env.PORT || 4321);
const OPEN_BROWSER = !process.argv.includes('--no-open');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const metaCache = new Map();
const CACHE_TTL = 1000 * 60 * 60 * 6;

const spotifyCache = new Map();
const SPOTIFY_TTL = 1000 * 60 * 10;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

async function fetchMeta(id) {
  const cached = metaCache.get(id);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data;

  const endpoint =
    'https://www.youtube.com/oembed?url=' +
    encodeURIComponent('https://www.youtube.com/watch?v=' + id) +
    '&format=json';

  const response = await fetch(endpoint, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'accept-language': 'es-ES,es;q=0.9,en;q=0.8'
    }
  });

  if (!response.ok) {
    const error = new Error('oembed ' + response.status);
    error.status = response.status;
    throw error;
  }

  const json = await response.json();
  const data = {
    id,
    title: json.title || '',
    author: json.author_name || '',
    thumbnail: json.thumbnail_url || 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'
  };
  metaCache.set(id, { at: Date.now(), data });
  return data;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function isValidVideoId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);
}

function parseSpotifyEmbed(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return null;
  }

  function findEntity(node, depth) {
    if (!node || typeof node !== 'object' || depth > 9) return null;
    if (Array.isArray(node.trackList) && node.trackList.length) return node;

    for (const key of Object.keys(node)) {
      const found = findEntity(node[key], depth + 1);
      if (found) return found;
    }
    return null;
  }

  const entity = findEntity(data, 0);
  if (!entity) return null;

  const items = [];
  const seen = new Set();

  for (const raw of entity.trackList) {
    const preview = raw && raw.audioPreview && raw.audioPreview.url;
    const title = String((raw && raw.title) || '').trim();
    const id = String((raw && raw.uri) || '').split(':').pop();

    if (!preview || !title || !id || seen.has(id)) continue;
    seen.add(id);

    items.push({
      id,
      title,
      artist: String((raw && raw.subtitle) || '').trim(),
      duration: Number(raw && raw.duration) || 0,
      preview: String(preview)
    });
  }

  const cover = entity.coverArt && entity.coverArt.sources && entity.coverArt.sources[0];

  return {
    name: String(entity.name || entity.title || 'Playlist de Spotify'),
    cover: (cover && cover.url) || '',
    total: entity.trackList.length,
    items
  };
}

async function handleSpotify(url, res) {
  const id = String(url.searchParams.get('id') || '').trim();

  if (!/^[A-Za-z0-9]{22}$/.test(id)) {
    return sendJson(res, 400, { error: 'ID de playlist de Spotify inválido.' });
  }

  const cached = spotifyCache.get(id);
  if (cached && Date.now() - cached.at < SPOTIFY_TTL) {
    return sendJson(res, 200, cached.data);
  }

  const response = await fetch('https://open.spotify.com/embed/playlist/' + id, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'accept-language': 'es-ES,es;q=0.9,en;q=0.8'
    }
  });

  if (!response.ok) {
    return sendJson(res, response.status === 404 ? 404 : 502, {
      error: 'No se pudo abrir la playlist de Spotify.'
    });
  }

  const data = parseSpotifyEmbed(await response.text());

  if (!data) {
    return sendJson(res, 404, {
      error: 'La playlist de Spotify no existe, es privada o no tiene adelantos disponibles.'
    });
  }

  if (!data.items.length) {
    return sendJson(res, 422, {
      error: 'Esta playlist no tiene adelantos de audio disponibles. Prueba con otra.'
    });
  }

  const payload = { id, ...data };
  spotifyCache.set(id, { at: Date.now(), data: payload });
  sendJson(res, 200, payload);
}

async function handleMetadata(url, res) {
  const raw = url.searchParams.get('ids') || '';
  const ids = [...new Set(raw.split(',').map((id) => id.trim()).filter(isValidVideoId))].slice(0, 40);

  if (!ids.length) {
    return sendJson(res, 400, { error: 'Faltan identificadores de vídeo válidos.' });
  }

  const items = await mapLimit(ids, 6, async (id) => {
    try {
      return await fetchMeta(id);
    } catch (error) {
      return { id, error: error.status === 404 ? 'not_found' : 'unavailable' };
    }
  });

  sendJson(res, 200, { items });
}

function handleStatic(url, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return sendJson(res, 400, { error: 'Ruta inválida.' });
  }

  if (pathname === '/' || pathname === '') pathname = '/index.html';

  const filePath = path.join(PUBLIC_DIR, pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Prohibido');
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado');
    }

    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[extension] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return sendJson(res, 400, { error: 'Petición inválida.' });
  }

  if (req.method === 'GET' && url.pathname === '/api/metadata') {
    try {
      return await handleMetadata(url, res);
    } catch (error) {
      return sendJson(res, 500, { error: 'No se pudieron obtener los datos.' });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/spotify/playlist') {
    try {
      return await handleSpotify(url, res);
    } catch (error) {
      return sendJson(res, 502, { error: 'No se pudo conectar con Spotify.' });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/estado') {
    return sendJson(res, 200, { ok: true, cache: metaCache.size });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'Método no permitido.' });
  }

  handleStatic(url, res);
});

function openBrowser(target) {
  if (!OPEN_BROWSER) return;
  const command =
    process.platform === 'win32'
      ? 'start "" "' + target + '"'
      : process.platform === 'darwin'
        ? 'open "' + target + '"'
        : 'xdg-open "' + target + '"';
  exec(command, () => {});
}

function listen(port, attemptsLeft) {
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log('El puerto ' + port + ' está ocupado, probando ' + (port + 1) + '…');
      PORT = port + 1;
      listen(PORT, attemptsLeft - 1);
      return;
    }
    console.error('No se pudo iniciar el servidor:', error.message);
    process.exit(1);
  });

  server.listen(PORT, '127.0.0.1', () => {
    const target = 'http://localhost:' + PORT;
    console.log('');
    console.log('  🎧  Adivina la Canción');
    console.log('  Servidor listo en ' + target);
    console.log('  Pulsa Ctrl+C para detenerlo.');
    console.log('');
    openBrowser(target);
  });
}

listen(PORT, 10);
