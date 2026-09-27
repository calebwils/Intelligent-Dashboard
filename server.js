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
const { Agent, setGlobalDispatcher } = require('undici');

// Configuration du répartiteur réseau avec timeouts étendus pour liaisons intercontinentales (Alibaba Cloud Singapore)
const globalAgent = new Agent({
  connect: {
    timeout: 35000 // 35s connect timeout au lieu de 10s par défaut
  },
  headersTimeout: 60000,
  bodyTimeout: 60000,
  keepAliveTimeout: 30000,
  keepAliveMaxTimeout: 60000
});
setGlobalDispatcher(globalAgent);

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
const DEFAULT_MODEL = 'qwen-flash';

/**
 * Fonction résiliente d'appel à l'API Qwen avec retentatives automatiques en cas de saut réseau
 */
async function callQwenApi(endpoint, apiKey, payload, maxRetries = 2) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      });
      const text = await resp.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = { message: text };
      }
      return { ok: resp.ok, status: resp.status, data, text, error: null };
    } catch (err) {
      lastErr = err;
      console.warn(`⚠️ Tentative ${attempt}/${maxRetries + 1} de connexion à Qwen échouée : ${err.message}`);
      if (attempt <= maxRetries) {
        await new Promise(r => setTimeout(r, 600 * attempt));
      }
    }
  }
  return { ok: false, status: 504, data: null, text: '', error: lastErr };
}

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

        let activeModel = model;
        console.log(`🤖 [AI Data Analyst] Appel Qwen -> Modèle: ${activeModel}, Messages: ${payload.messages?.length || 0}`);

        let callResult = await callQwenApi(endpoint, apiKey, {
          model: activeModel,
          messages: payload.messages || [],
          temperature: payload.temperature !== undefined ? payload.temperature : 0.2,
          max_tokens: payload.max_tokens || 2048
        });

        // Si le modèle demandé a son quota gratuit épuisé, repli automatique immédiat sur qwen-flash
        if (!callResult.ok && activeModel !== 'qwen-flash' && (callResult.status === 403 || (callResult.text && callResult.text.toLowerCase().includes('quota')))) {
          console.log(`⚠️ Quota épuisé pour le modèle ${activeModel}. Basculement automatique immédiat sur qwen-flash...`);
          activeModel = 'qwen-flash';
          callResult = await callQwenApi(endpoint, apiKey, {
            model: activeModel,
            messages: payload.messages || [],
            temperature: payload.temperature !== undefined ? payload.temperature : 0.2,
            max_tokens: payload.max_tokens || 2048
          });
        }

        if (callResult.error) {
          console.error('❌ Erreur réseau persistante avec Qwen:', callResult.error);
          res.writeHead(504, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            error: 'NETWORK_TIMEOUT',
            message: `Délai de connexion dépassé avec l'API Qwen (${callResult.error.message}). Veuillez réessayer dans un instant.`
          }));
          return;
        }

        if (!callResult.ok) {
          console.error('❌ Erreur API Qwen:', callResult.data);
          res.writeHead(callResult.status, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            error: 'QWEN_API_ERROR',
            message: callResult.data?.error?.message || callResult.data?.message || 'Erreur API Qwen',
            details: callResult.data
          }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(callResult.data));
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
  // ROUTE 3 : POST /api/send-email (Expédition d'emails d'audit et analyses)
  // ========================================================================
  if (req.method === 'POST' && pathname === '/api/send-email') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        req.body = body ? JSON.parse(body) : {};
      } catch (e) {
        req.body = {};
      }

      try {
        const sendEmailHandler = require('./api/send-email.js');
        await sendEmailHandler(req, res);
      } catch (err) {
        console.error('❌ Erreur route send-email:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          error: 'SEND_EMAIL_ROUTE_ERROR',
          message: err.message
        }));
      }
    });
    return;
  }

  // ========================================================================
  // ROUTE 4 : Serveur de fichiers statiques (Dashboard V2)
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
  console.log(`📧 Passerelle Email Gmail active sur : http://localhost:${PORT}/api/send-email`);
  console.log(`🔒 Clé API & SMTP protégés via .env (ignorés par Git)`);
  console.log('====================================================================');
});
