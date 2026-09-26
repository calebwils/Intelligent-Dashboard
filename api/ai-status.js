/**
 * Vercel Serverless Function — GET /api/ai-status
 * Vérifie si une clé API est configurée côté serveur (variables d'environnement Vercel)
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, x-base-url');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const hasKey = !!(process.env.QWEN_API_KEY && process.env.QWEN_API_KEY.trim().length > 0);
  const baseUrl = process.env.QWEN_BASE_URL || 'https://ws-hrpprn3nx2citb4c.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
  const model = process.env.QWEN_MODEL || 'qwen-flash';

  return res.status(200).json({
    hasEnvKey: hasKey,
    baseUrl: baseUrl,
    model: model
  });
};
