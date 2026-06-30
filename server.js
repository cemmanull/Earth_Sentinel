import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT ?? 3000;
const GO_BACKEND_URL = process.env.GO_BACKEND_URL ?? 'http://localhost:8080';

app.use(express.static(path.join(__dirname, 'public')));

// GDACS proxy — aceita ?types=EQ&alertlevel=Red para consultas separadas por tipo e nível
const GDACS_ALLOWED_TYPES  = new Set(['EQ', 'TC', 'FL', 'VO', 'DR', 'WF', 'TS'])
const GDACS_ALLOWED_LEVELS = new Set(['Green', 'Orange', 'Red'])

app.get('/api/gdacs/events', async (req, res) => {
  const rawTypes = req.query.types ?? 'EQ;TC;FL;VO;DR;WF'
  const types    = rawTypes.split(';').filter(t => GDACS_ALLOWED_TYPES.has(t))
  if (!types.length) return res.status(400).json({ error: 'Nenhum tipo válido. Use EQ, TC, FL, VO, DR, WF, TS.' })

  const rawLevel = req.query.alertlevel ?? 'Green;Orange;Red'
  const levels   = rawLevel.split(';').filter(l => GDACS_ALLOWED_LEVELS.has(l))
  if (!levels.length) return res.status(400).json({ error: 'Nenhum nível válido. Use Green, Orange, Red.' })

  const url = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH' +
    `?eventlist=${types.join(';')}&alertlevel=${levels.join(';')}`
  try {
    const upstream = await fetch(url, {
      signal:  AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json' },
    })
    if (!upstream.ok) throw new Error(`GDACS upstream HTTP ${upstream.status}`)
    const text = await upstream.text()
    // GDACS retorna body vazio (sem features) para combinações sem eventos
    if (!text.trim()) return res.json({ features: [] })
    let data
    try { data = JSON.parse(text) } catch { return res.json({ features: [] }) }
    res.json(data)
  } catch (err) {
    console.warn('[GDACS] proxy falhou:', err.message)
    res.status(502).json({ error: err.message })
  }
});

// Proxy /api/* → Go backend (except /api/gdacs/events above, matched first)
app.use('/api', (req, res) => {
  const target = new URL(req.originalUrl, GO_BACKEND_URL);
  const options = {
    hostname: target.hostname,
    port:     parseInt(target.port) || 8080,
    path:     target.pathname + target.search,
    method:   req.method,
    headers:  { ...req.headers, host: target.host },
  };

  const proxy = http.request(options, (upstream) => {
    res.writeHead(upstream.statusCode, upstream.headers);
    upstream.pipe(res);
  });

  proxy.on('error', (err) => {
    console.warn('[go-proxy] backend unreachable:', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'backend unavailable' });
  });

  req.pipe(proxy);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
