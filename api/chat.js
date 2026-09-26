/**
 * Vercel Serverless Function — POST /api/chat
 * Passerelle sécurisée et résiliente vers l'API Qwen (Alibaba Cloud)
 */
const { Agent, setGlobalDispatcher } = require('undici');

try {
  const globalAgent = new Agent({
    connect: { timeout: 35000 },
    headersTimeout: 60000,
    bodyTimeout: 60000
  });
  setGlobalDispatcher(globalAgent);
} catch (e) {
  // Ignorer si déjà initialisé
}

const DEFAULT_QWEN_BASE = 'https://ws-hrpprn3nx2citb4c.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
const DEFAULT_MODEL = 'qwen-flash';

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
      if (attempt <= maxRetries) {
        await new Promise(r => setTimeout(r, 600 * attempt));
      }
    }
  }
  return { ok: false, status: 504, data: null, text: '', error: lastErr };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, x-base-url');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED', message: 'Only POST is allowed' });
  }

  // Support pour payload parsé par Vercel ou brut
  let payload = req.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (e) {
      payload = {};
    }
  }
  payload = payload || {};

  const apiKey = (process.env.QWEN_API_KEY || '').trim() || (req.headers['x-api-key'] || '').trim();
  const baseUrl = (process.env.QWEN_BASE_URL || '').trim() || (req.headers['x-base-url'] || '').trim() || DEFAULT_QWEN_BASE;
  const model = payload.model || process.env.QWEN_MODEL || DEFAULT_MODEL;

  if (!apiKey) {
    return res.status(400).json({
      error: 'MISSING_API_KEY',
      message: 'Aucune clé API Qwen configurée. Veuillez renseigner votre clé dans les variables d\'environnement Vercel ou dans les paramètres du chatbot.'
    });
  }

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  let activeModel = model;

  let callResult = await callQwenApi(endpoint, apiKey, {
    model: activeModel,
    messages: payload.messages || [],
    temperature: payload.temperature !== undefined ? payload.temperature : 0.2,
    max_tokens: payload.max_tokens || 2048
  });

  // Si quota épuisé sur un autre modèle, repli automatique immédiat sur qwen-flash
  if (!callResult.ok && activeModel !== 'qwen-flash' && (callResult.status === 403 || (callResult.text && callResult.text.toLowerCase().includes('quota')))) {
    activeModel = 'qwen-flash';
    callResult = await callQwenApi(endpoint, apiKey, {
      model: activeModel,
      messages: payload.messages || [],
      temperature: payload.temperature !== undefined ? payload.temperature : 0.2,
      max_tokens: payload.max_tokens || 2048
    });
  }

  if (callResult.error) {
    return res.status(504).json({
      error: 'NETWORK_TIMEOUT',
      message: `Délai de connexion dépassé avec l'API Qwen (${callResult.error.message}). Veuillez réessayer.`
    });
  }

  if (!callResult.ok) {
    return res.status(callResult.status).json({
      error: 'QWEN_API_ERROR',
      message: callResult.data?.error?.message || callResult.data?.message || 'Erreur API Qwen',
      details: callResult.data
    });
  }

  return res.status(200).json(callResult.data);
};
