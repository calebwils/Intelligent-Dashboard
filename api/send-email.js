/**
 * Vercel Serverless Function — POST /api/send-email
 * Passerelle d'expédition d'analyses et de rapports d'audit par email via Gmail SMTP
 */
const nodemailer = require('nodemailer');

function formatExecutiveHtmlEmail(title, contentHtml, recipient) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || "Rapport d'Analyse Financière"}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #060913; color: #f8fafc; margin: 0; padding: 20px; line-height: 1.6; }
    .card { background-color: #0e1626; border-radius: 14px; border: 1px solid rgba(255,255,255,0.12); max-width: 680px; margin: 0 auto; overflow: hidden; box-shadow: 0 15px 40px rgba(0,0,0,0.6); }
    .header { background: linear-gradient(135deg, #090e1a 0%, #141f36 100%); padding: 26px 32px; border-bottom: 2px solid #06b6d4; }
    .brand-title { font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: 0.04em; margin: 0; }
    .brand-sub { font-size: 13px; color: #94a3b8; margin: 5px 0 0; }
    .badge { display: inline-block; background: rgba(6,182,212,0.15); color: #06b6d4; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; margin-top: 10px; border: 1px solid rgba(6,182,212,0.3); }
    .content { padding: 32px; color: #cbd5e1; font-size: 14px; }
    .kpi-row { display: table; width: 100%; margin: 20px 0; border-spacing: 8px; }
    .kpi-cell { display: table-cell; width: 50%; background: #141f35; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 14px 18px; box-sizing: border-box; }
    .kpi-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 700; margin-bottom: 4px; }
    .kpi-val { font-size: 17px; font-weight: 800; color: #ffffff; }
    .analysis-body { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 20px; margin: 20px 0; font-size: 13.5px; line-height: 1.65; color: #e2e8f0; }
    .analysis-body h1, .analysis-body h2, .analysis-body h3 { color: #38bdf8; margin-top: 0; }
    .analysis-body ul, .analysis-body ol { padding-left: 20px; margin: 10px 0; }
    .analysis-body li { margin-bottom: 6px; }
    .analysis-body table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 12.5px; }
    .analysis-body th { background: #141f35; color: #94a3b8; text-align: left; padding: 8px 10px; border: 1px solid rgba(255,255,255,0.1); }
    .analysis-body td { padding: 8px 10px; border: 1px solid rgba(255,255,255,0.07); }
    .footer { padding: 20px 32px; background-color: #070b14; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid rgba(255,255,255,0.06); }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="brand-title">AIFORCE AGENCY</div>
      <div class="brand-sub">Plateforme Exécutive des Approvisionnements & Comptabilité Fournisseurs 2.0</div>
      <span class="badge">RAPPORT TRANSMIS PAR L'AI DATA ANALYST</span>
    </div>
    <div class="content">
      <p style="margin-top: 0;">
        Bonjour,<br><br>
        À votre demande, votre <strong>AI Data Analyst</strong> vous transmet ci-dessous son analyse experte et son rapport financier :
      </p>

      <div class="analysis-body">
        ${contentHtml}
      </div>

      <div class="kpi-row">
        <div class="kpi-cell">
          <div class="kpi-label">Périmètre Base Données</div>
          <div class="kpi-val" style="color: #38bdf8;">88 Factures • 25 BCs</div>
        </div>
        <div class="kpi-cell">
          <div class="kpi-label">Volume Total TTC</div>
          <div class="kpi-val" style="color: #34d399;">221 350 000 FCFA</div>
        </div>
      </div>

      <p style="font-size: 12px; color: #94a3b8; margin-top: 25px;">
        Destinataire certifié : <code>${recipient}</code><br>
        Horodatage : ${new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Porto-Novo' })}
      </p>
    </div>
    <div class="footer">
      © 2026 AIFORCE AGENCY • Intelligence Financière & Automatisation des Achats • Transmission Sécurisée
    </div>
  </div>
</body>
</html>
  `;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  const sendJsonResponse = (statusCode, data) => {
    if (res.status && typeof res.status === 'function') {
      return res.status(statusCode).json(data);
    }
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };

  if (req.method === 'OPTIONS') {
    if (res.status && typeof res.status === 'function') {
      return res.status(204).end();
    }
    res.writeHead(204);
    return res.end();
  }

  if (req.method !== 'POST') {
    return sendJsonResponse(405, { error: 'METHOD_NOT_ALLOWED', message: 'Only POST is allowed' });
  }

  try {
    let payload = req.body;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch (e) {
        payload = {};
      }
    }
    payload = payload || {};

    const smtpUser = (process.env.SMTP_USER || '').trim();
    const smtpPass = (process.env.SMTP_PASS || '').trim();
    const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
    const smtpPort = parseInt(process.env.SMTP_PORT || '465', 10);
    const defaultRecipient = process.env.DEFAULT_RECIPIENT_EMAIL || 'procure.test.ai@gmail.com';

    if (!smtpUser || !smtpPass) {
      return sendJsonResponse(500, {
        error: 'SMTP_CONFIG_MISSING',
        message: 'Configuration SMTP incomplète. Veuillez renseigner SMTP_USER et SMTP_PASS dans les variables d\'environnement (.env ou Vercel).'
      });
    }

    const to = (payload.to || '').trim() || defaultRecipient;
    const subject = (payload.subject || '').trim() || "📊 [AIFORCE AGENCY] Rapport Exécutif d'Analyse & Audit";
    const title = payload.title || "Rapport d'Analyse Financière";
    
    // Contenu : soit HTML direct, soit texte brut
    let contentHtml = payload.htmlContent;
    if (!contentHtml && payload.textContent) {
      contentHtml = `<p>${payload.textContent.replace(/\n/g, '<br>')}</p>`;
    }
    if (!contentHtml) {
      contentHtml = `<p>Synthèse exécutive générée par l'AI Data Analyst sur les 88 factures et 25 bons de commande.</p>`;
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    });

    const fullHtml = formatExecutiveHtmlEmail(title, contentHtml, to);

    const info = await transporter.sendMail({
      from: `"AIFORCE AGENCY — AI Data Analyst" <${smtpUser}>`,
      to: to,
      subject: subject,
      text: payload.textContent || "Veuillez consulter la version HTML de ce message.",
      html: fullHtml
    });

    console.log(`✉️ Email envoyé avec succès à ${to}. MessageId: ${info.messageId}`);

    return sendJsonResponse(200, {
      success: true,
      message: 'Email envoyé avec succès',
      messageId: info.messageId,
      recipient: to,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('❌ Erreur lors de l\'envoi de l\'email:', err);
    return sendJsonResponse(500, {
      error: 'EMAIL_SEND_FAILED',
      message: err.message || 'Impossible d\'expédier le courriel'
    });
  }
};
