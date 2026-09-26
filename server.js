/**
 * AIFORCE AGENCY — Serveur Local Sécurisé & Passerelle IA Qwen
 * 
 * Rôles :
 * 1. Servir les fichiers statiques du tableau de bord (HTML, CSS, JS, Assets)
 * 2. Agir comme proxy sécurisé pour l'API Qwen (Alibaba Cloud)
 * 3. Protéger à 100% la clé API en la lisant depuis le fichier .env (jamais exposée au navigateur ni sur GitHub)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// 1. Chargement sécurisé des variables du fichier .env
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        // Retirer les guillemets éventuels
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    });
    console.log('🔒 Fichier .env chargé avec succès.');
  } else {
    console.log('ℹ️ Aucun fichier .env trouvé (utilisation des variables système).');
  }
}

loadEnv();

const PORT = parseInt(process.env.PORT || '8080', 10);
const DEFAULT_QWEN_BASE = 'https://ws-hrpprn3nx2citb4c.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
const DEFAULT_MODEL = 'qwen-plus';

// Types MIME pour les fichiers statiques
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // En-têtes CORS universels pour l'application
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, x-base-url');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ========================================================================
  // ROUTE 1 : GET /api/ai-status (Vérifier si une clé est configurée dans .env)
  // ========================================================================
  if (req.method === 'GET' && pathname === '/api/ai-status') {
    const hasKey = !!(process.env.QWEN_API_KEY && process.env.QWEN_API_KEY.trim().length > 0);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      hasEnvKey: hasKey,
      baseUrl: process.env.QWEN_BASE_URL || DEFAULT_QWEN_BASE,
      model: process.env.QWEN_MODEL || DEFAULT_MODEL
    }));
    return;
  }

  // ========================================================================
  // ROUTE 2 : POST /api/chat (Passerelle IA Qwen sécurisée)
  // ========================================================================
  if (req.method === 'POST' && pathname === '/api/chat') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');

        // Récupérer la clé API : soit du .env serveur, soit du header client (si configuré dans l'UI)
        const apiKey = (process.env.QWEN_API_KEY || '').trim() || (req.headers['x-api-key'] || '').trim();
        const baseUrl = (process.env.QWEN_BASE_URL || '').trim() || (req.headers['x-base-url'] || '').trim() || DEFAULT_QWEN_BASE;
        const model = payload.model || process.env.QWEN_MODEL || DEFAULT_MODEL;

        if (!apiKey) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            error: 'MISSING_API_KEY',
            message: 'Aucune clé API Qwen configurée. Veuillez renseigner votre clé dans le fichier .env ou dans les paramètres du chatbot.'
          }));
          return;
        }

        const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

        console.log(`🤖 [AI Data Analyst] Appel Qwen -> Modèle: ${model}, Messages: ${payload.messages?.length || 0}`);

        const qwenResponse = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: model,
            messages: payload.messages || [],
            temperature: payload.temperature !== undefined ? payload.temperature : 0.3,
            max_tokens: payload.max_tokens || 2048
          })
        });

        const qwenData = await qwenResponse.json();

        if (!qwenResponse.ok) {
          console.error('❌ Erreur API Qwen:', qwenData);
          res.writeHead(qwenResponse.status, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            error: 'QWEN_API_ERROR',
            details: qwenData
          }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(qwenData));
      } catch (err) {
        console.error('❌ Erreur interne proxy chat:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          error: 'INTERNAL_PROXY_ERROR',
          message: err.message
        }));
      }
    });
    return;
  }

  // ========================================================================
  // ROUTE 3 : Serveur de fichiers statiques (Dashboard V2)
  // ========================================================================
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

  // Sécurité anti directory traversal
  const safePath = path.resolve(__dirname);
  if (!path.resolve(filePath).startsWith(safePath)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Accès refusé');
    return;
  }

  // Interdire l'accès direct aux fichiers secrets .env
  if (path.basename(filePath).startsWith('.env') || path.basename(filePath) === '.gitignore') {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Fichier confidentiel protégé');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404 — Fichier introuvable</h1>');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log('====================================================================');
  console.log(`🚀 AIFORCE AGENCY Dashboard V2 en direct sur : http://localhost:${PORT}`);
  console.log(`🤖 Passerelle IA Qwen active sur : http://localhost:${PORT}/api/chat`);
  console.log(`🔒 Clé API protégée via .env (ignorée par Git)`);
  console.log('====================================================================');
});
