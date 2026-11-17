// Вход по коду из почты напрямую через EmailJS (без почтовых лимитов Supabase).
// POST /api/email-code {action:'send', email}               -> {ticket, exp}   (код уходит на почту)
// POST /api/email-code {action:'verify', email, code, ticket} -> {session, email, exp}
// Ничего не хранит: ticket и session подписаны секретом SEND_EMAIL_HOOK_SECRET (переменная Vercel).
// Нужны также EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY.
const crypto = require('crypto');

const SECRET = () => String(process.env.SEND_EMAIL_HOOK_SECRET || process.env.EMAIL_CODE_SECRET || '');
const b64u = b => Buffer.from(b).toString('base64url');
const sign = s => crypto.createHmac('sha256', 'sg-email-code:' + SECRET()).update(s).digest('base64url');
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const CODE_TTL = 10 * 60, SESSION_TTL = 30 * 24 * 3600;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.setEncoding('utf8');
    req.on('data', c => { d += c; if (d.length > 1e4) req.destroy(); });
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });
}
function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*'); // игра открывается и из приложений (file://, http://sprintgames.app)
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(obj));
}

// значения из Vercel без пробелов, кавычек и случайного «имя=» при вставке
const env = k => String(process.env[k] || '').trim().replace(/^[A-Z_]+\s*=\s*/, '').replace(/^["'`]|["'`]$/g, '').trim();

// публичный ключ EmailJS не секретный (Account -> API keys -> Public Key)
const EMAILJS_PUBLIC_KEY = 'a2Q8zBdk3etZILPf2';

async function emailjs(to, code) {
  const r = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: 'service_wlyob34',
      template_id: 'template_3vx4uqc',
      user_id: EMAILJS_PUBLIC_KEY,
      accessToken: env('EMAILJS_PRIVATE_KEY'),
      template_params: { to_email: to, email: to, code, subject: 'Код для входа в SprintGames' }
    })
  });
  if (!r.ok) throw new Error('EmailJS ' + r.status + ': ' + (await r.text()).slice(0, 200));
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if (!SECRET()) return send(res, 500, { error: 'Сервер входа не настроен' });
  let p;
  try { p = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'Неверный запрос' }); }
  const email = String(p.email || '').trim().toLowerCase();
  if (!EMAIL.test(email)) return send(res, 400, { error: 'Неверный адрес почты' });
  const now = Math.floor(Date.now() / 1000);

  if (p.action === 'send') {
    const code = String(crypto.randomInt(0, 1e8)).padStart(8, '0');
    const exp = now + CODE_TTL;
    const body = b64u(JSON.stringify({ e: email, x: exp, h: sign('code:' + email + ':' + code + ':' + exp) }));
    try { await emailjs(email, code); } catch (e) { return send(res, 502, { error: 'Не удалось отправить письмо: ' + e.message }); }
    return send(res, 200, { ticket: body + '.' + sign('ticket:' + body), exp });
  }

  if (p.action === 'verify') {
    const code = String(p.code || '').replace(/\D/g, '');
    const [body, sig] = String(p.ticket || '').split('.');
    if (!body || !sig || !eq(sig, sign('ticket:' + body))) return send(res, 400, { error: 'Запросите код заново' });
    let t; try { t = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return send(res, 400, { error: 'Запросите код заново' }); }
    if (t.e !== email) return send(res, 400, { error: 'Код был отправлен на другую почту' });
    if (t.x < now) return send(res, 400, { error: 'Код устарел — запросите новый' });
    if (code.length !== 8 || !eq(t.h, sign('code:' + email + ':' + code + ':' + t.x))) return send(res, 400, { error: 'Неверный код' });
    const exp = now + SESSION_TTL;
    const s = b64u(JSON.stringify({ e: email, x: exp }));
    return send(res, 200, { session: s + '.' + sign('session:' + s), email, exp });
  }
  send(res, 400, { error: 'Неизвестное действие' });
};
