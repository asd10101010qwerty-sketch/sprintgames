// Supabase «Send Email Hook» -> письмо с кодом входа через EmailJS.
// Код придумывает и проверяет Supabase; здесь только доставка письма.
// Переменные окружения Vercel (Settings -> Environment Variables):
//   SEND_EMAIL_HOOK_SECRET  — секрет хука из Supabase (v1,whsec_...)
//   EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY
const crypto = require('crypto');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.setEncoding('utf8');
    req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });
}

// подпись Standard Webhooks: base64(HMAC-SHA256(secret, id.timestamp.body))
function verify(req, body) {
  const secret = String(process.env.SEND_EMAIL_HOOK_SECRET || '').replace(/^v1,/, '').replace(/^whsec_/, '');
  if (!secret) return false;
  const id = req.headers['webhook-id'], ts = req.headers['webhook-timestamp'], sig = String(req.headers['webhook-signature'] || '');
  if (!id || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // не старше 5 минут
  const expected = crypto.createHmac('sha256', Buffer.from(secret, 'base64')).update(`${id}.${ts}.${body}`).digest();
  return sig.split(' ').some(part => {
    const [ver, val] = part.split(',');
    if (ver !== 'v1' || !val) return false;
    const got = Buffer.from(val, 'base64');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

const SUBJECT = {
  magiclink: 'Код для входа в SprintGames',
  signup: 'Код для входа в SprintGames',
  email_change: 'Подтверждение новой почты SprintGames',
  recovery: 'Код для входа в SprintGames',
  invite: 'Приглашение в SprintGames',
  reauthentication: 'Код подтверждения SprintGames'
};

const fail = (res, code, message) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: { http_code: code, message } })); };

module.exports = async (req, res) => {
  if (req.method !== 'POST') return fail(res, 405, 'POST only');
  let body;
  try { body = await readBody(req); } catch { return fail(res, 400, 'bad body'); }
  if (!verify(req, body)) return fail(res, 401, 'bad signature');
  let p;
  try { p = JSON.parse(body); } catch { return fail(res, 400, 'bad json'); }
  const email = p.user && p.user.email, d = p.email_data || {};
  const code = d.token || d.token_new;
  if (!email || !code) return fail(res, 400, 'no email or code');
  try {
    const r = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: process.env.EMAILJS_SERVICE_ID,
        template_id: process.env.EMAILJS_TEMPLATE_ID,
        user_id: process.env.EMAILJS_PUBLIC_KEY,
        accessToken: process.env.EMAILJS_PRIVATE_KEY,
        template_params: { to_email: email, email, code, subject: SUBJECT[d.email_action_type] || SUBJECT.magiclink }
      })
    });
    // 400 — чтобы Supabase показал причину отказа EmailJS, а не «unexpected status»
    if (!r.ok) return fail(res, 400, 'EmailJS ' + r.status + ': ' + (await r.text()).slice(0, 200));
  } catch (e) {
    return fail(res, 400, 'EmailJS недоступен: ' + (e && e.message));
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end('{}');
};
