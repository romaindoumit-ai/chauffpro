// Envoi des SMS et e-mails. Sans clé API, l'application tourne en « mode simulation » :
// rien n'est envoyé, mais tout est enregistré et visible dans le tableau de bord.
const cfg = () => ({
  sms: (process.env.SMS_PROVIDER || (process.env.BREVO_API_KEY ? 'brevo' : process.env.TWILIO_ACCOUNT_SID ? 'twilio' : 'simulation')).toLowerCase(),
  email: (process.env.EMAIL_PROVIDER || (process.env.BREVO_API_KEY ? 'brevo' : 'simulation')).toLowerCase(),
});

function smsSender(account) {
  const s = (account.sms_sender || account.company_name || 'Artisan').normalize('NFD').replace(/[^A-Za-z0-9]/g, '');
  return (s || 'Artisan').slice(0, 11);
}

async function sendSms(account, to, body, { marketing = false } = {}) {
  const mode = cfg().sms;
  if (mode === 'simulation') return { simulated: true };
  if (mode === 'brevo') {
    const r = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: smsSender(account), recipient: to.replace('+', ''), content: body, type: marketing ? 'marketing' : 'transactional', unicodeEnabled: true }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Brevo SMS ${r.status}: ${j.message || JSON.stringify(j)}`);
    return { id: String(j.messageId || j.reference || '') };
  }
  if (mode === 'twilio') {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const form = new URLSearchParams({ To: to, Body: body, From: process.env.TWILIO_FROM || smsSender(account) });
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Twilio ${r.status}: ${j.message || ''}`);
    return { id: j.sid };
  }
  throw new Error(`SMS_PROVIDER inconnu : ${mode}`);
}

async function sendEmail(account, { to, subject, html, text }) {
  const mode = cfg().email;
  if (mode === 'simulation') return { simulated: true };
  if (mode === 'brevo') {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: account.company_name || 'Notification', email: process.env.EMAIL_FROM },
        replyTo: account.email ? { email: account.email, name: account.company_name } : undefined,
        to: [{ email: to }], subject, htmlContent: html, textContent: text,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Brevo e-mail ${r.status}: ${j.message || JSON.stringify(j)}`);
    return { id: j.messageId };
  }
  throw new Error(`EMAIL_PROVIDER inconnu : ${mode}`);
}

module.exports = { sendSms, sendEmail, providerMode: cfg };
