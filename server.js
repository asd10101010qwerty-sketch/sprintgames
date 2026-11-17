// Сервер SprintGames: отдаёт страницу игры и пересылает данные между игроками.
// Запуск: node server.js   (порт можно задать переменной PORT)
// Программа SprintGames для Windows подключает этот файл и запускает сервер через start().
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const INDEX = path.join(__dirname, 'index.html');
// файлы приложения SprintGames (только этот список, другие файлы папки не отдаются)
const STATIC = {
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/icons/icon-192.png': ['icons/icon-192.png', 'image/png'],
  '/icons/icon-512.png': ['icons/icon-512.png', 'image/png'],
  '/icons/apple-touch-icon.png': ['icons/apple-touch-icon.png', 'image/png'],
  '/icons/favicon-64.png': ['icons/favicon-64.png', 'image/png'],
  '/favicon.ico': ['icons/favicon-64.png', 'image/png'],
  '/SprintGames.apk': ['SprintGames.apk', 'application/vnd.android.package-archive'],
  '/SprintGames-Setup.exe': ['SprintGames-Setup.exe', 'application/octet-stream']
};

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500); return res.end('index.html не найден'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  } else if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('ok');
  } else if (STATIC[url]) {
    const [file, type] = STATIC[url];
    const full = path.join(__dirname, file);
    fs.stat(full, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end(); }
      const headers = { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache' };
      if (/\.(apk|exe)$/.test(file)) headers['Content-Disposition'] = `attachment; filename="${path.basename(file)}"`;
      res.writeHead(200, headers);
      fs.createReadStream(full).pipe(res); // большие файлы (установщик) отдаём потоком
    });
  } else if (url === '/info') {
    // приложение SprintGames ищет сервер в сети по этому адресу (поэтому разрешён доступ с любой страницы)
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ app: 'sprintgames', port: Number(PORT), ips: lanIps() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

// Адреса этого компьютера в локальных сетях (Wi-Fi, кабель, точка доступа).
// Точка доступа Windows обычно 192.168.137.1 — её ставим первой, виртуальные адаптеры — в конец.
function lanIps() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces()))
    for (const a of list || [])
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal)
        out.push({ name, address: a.address, hotspot: a.address.startsWith('192.168.137.') });
  const virt = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback|Bluetooth|docker|vbox|virbr|Tailscale|ZeroTier/i;
  return out.sort((a, b) => (b.hotspot - a.hotspot) || (virt.test(a.name) - virt.test(b.name)));
}

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
const rooms = new Map();
let nextPid = 1;

const clean = (s, n, def) => (String(s || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, n)) || def;
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };

function newId() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do { id = Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join(''); } while (rooms.has(id));
  return id;
}
function roomInfo(r) {
  return {
    id: r.id, name: r.name, max: r.max, game: r.game, state: r.state,
    players: [...r.members.values()].map(m => ({ slot: m.slot, nick: m.nick, pid: m.pid })).sort((a, b) => a.slot - b.slot)
  };
}
function pushRoom(r) {
  const msg = JSON.stringify({ t: 'room', room: roomInfo(r) });
  for (const m of r.members.values()) if (m.ws.readyState === 1) m.ws.send(msg);
}
function leave(ws) {
  const r = ws.room;
  if (!r) return;
  ws.room = null;
  r.members.delete(ws.pid);
  if (r.host === ws) {
    rooms.delete(r.id);
    for (const m of r.members.values()) { m.ws.room = null; send(m.ws, { t: 'closed' }); }
    console.log(`Сервер ${r.id} закрыт`);
  } else {
    send(r.host, { t: 'left', pid: ws.pid });
    pushRoom(r);
  }
}

wss.on('connection', ws => {
  ws.pid = nextPid++;
  ws.room = null;
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const r = ws.room;

    switch (m.t) {
      case 'list':
        send(ws, {
          t: 'list',
          rooms: [...rooms.values()].map(x => ({ id: x.id, name: x.name, max: x.max, game: x.game, state: x.state, count: x.members.size }))
        });
        break;

      case 'create': {
        leave(ws);
        const room = {
          id: newId(),
          name: clean(m.name, 24, 'Сервер'),
          max: Math.min(4, Math.max(2, m.max | 0)),
          game: Math.min(3, Math.max(0, m.game | 0)),
          state: 'lobby',
          host: ws,
          members: new Map()
        };
        rooms.set(room.id, room);
        room.members.set(ws.pid, { ws, pid: ws.pid, slot: 0, nick: clean(m.nick, 12, 'Игрок') });
        ws.room = room;
        send(ws, { t: 'joined', id: room.id, pid: ws.pid, host: true });
        pushRoom(room);
        console.log(`Создан сервер ${room.id} «${room.name}»`);
        break;
      }

      case 'join': {
        const room = rooms.get(String(m.id || '').toUpperCase());
        if (!room) return send(ws, { t: 'err', msg: 'Сервер не найден' });
        if (room === r) return;
        if (room.state !== 'lobby') return send(ws, { t: 'err', msg: 'На этом сервере уже идёт игра' });
        if (room.members.size >= room.max) return send(ws, { t: 'err', msg: 'Сервер заполнен' });
        leave(ws);
        const used = new Set([...room.members.values()].map(x => x.slot));
        let slot = 1;
        while (used.has(slot)) slot++;
        room.members.set(ws.pid, { ws, pid: ws.pid, slot, nick: clean(m.nick, 12, 'Игрок') });
        ws.room = room;
        send(ws, { t: 'joined', id: room.id, pid: ws.pid, host: false });
        pushRoom(room);
        break;
      }

      case 'leave':
        leave(ws);
        break;

      case 'meta':
        if (!r || r.host !== ws) return;
        if ('game' in m && r.state === 'lobby') r.game = Math.min(3, Math.max(0, m.game | 0));
        if (m.state === 'playing' || m.state === 'lobby') r.state = m.state;
        pushRoom(r);
        break;

      case 'relay':
        if (!r) return;
        if (r.host === ws) {
          // хост -> всем гостям
          const out = JSON.stringify({ t: 'relay', d: m.d });
          for (const mem of r.members.values()) if (mem.ws !== ws && mem.ws.readyState === 1) mem.ws.send(out);
        } else {
          // гость -> хосту
          send(r.host, { t: 'relay', from: ws.pid, d: m.d });
        }
        break;
    }
  });

  ws.on('close', () => leave(ws));
  ws.on('error', () => {});
});

// отключаем «зависшие» соединения
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 15000);

function logStart() {
  console.log(`\n[${new Date().toLocaleString('ru-RU')}] SprintGames: сервер запущен на http://localhost:${PORT}`);
  for (const a of lanIps()) console.log(`  ${a.hotspot ? 'Точка доступа' : 'Локальная сеть'}: http://${a.address}:${PORT}   (${a.name})`);
  console.log('');
}

if (require.main === module) {
  // запуск командой node server.js
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') console.log(`Порт ${PORT} уже занят — похоже, сервер уже запущен.`);
    else console.log('Ошибка сервера:', err.message);
    process.exit(1);
  });
  server.listen(PORT, logStart);
} else {
  // запуск из программы SprintGames для Windows
  module.exports = {
    start: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(PORT, () => { server.off('error', reject); logStart(); resolve(PORT); });
    }),
    stop: () => new Promise(r => { for (const c of wss.clients) c.terminate(); server.close(() => r()); })
  };
}
