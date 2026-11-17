// SprintGames для Windows: окно с игрой + поиск сервера в сети.
// Если сервера в сети нет — программа сама становится сервером (к ней смогут подключиться телефоны и другие ПК).
const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path'), os = require('os'), http = require('http');

const PORT = 3000;
const APP_DIR = path.join(__dirname, 'app');
let win = null, serverPromise = null, ownServer = null;

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function localIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || [])
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal && /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(a.address)) out.push(a.address);
  return out;
}

// это сервер SprintGames?
function probe(host, timeout = 900) {
  const [h, p] = host.split(':');
  return new Promise(res => {
    const req = http.get({ host: h, port: +p, path: '/info', timeout }, r => {
      let d = ''; r.setEncoding('utf8');
      r.on('data', c => { d += c; if (d.length > 4096) req.destroy(); });
      r.on('end', () => { try { res(JSON.parse(d).app === 'sprintgames' ? host : null); } catch { res(null); } });
    });
    req.on('timeout', () => { req.destroy(); res(null); });
    req.on('error', () => res(null));
  });
}

async function discover() {
  if (await probe('127.0.0.1:' + PORT, 700)) return 'localhost:' + PORT;
  let ips = localIps();
  if (ips.some(ip => !ip.startsWith('10.'))) ips = ips.filter(ip => !ip.startsWith('10.'));
  const cands = [], seen = new Set(), add = c => { if (!seen.has(c)) { seen.add(c); cands.push(c); } };
  add('192.168.137.1:' + PORT);
  for (const ip of ips) add(ip.split('.').slice(0, 3).join('.') + '.1:' + PORT);
  for (const ip of ips) { const b = ip.split('.').slice(0, 3).join('.'); for (let i = 2; i < 255; i++) if (`${b}.${i}` !== ip) add(`${b}.${i}:${PORT}`); }
  for (let i = 0; i < cands.length; i += 128) {
    const found = (await Promise.all(cands.slice(i, i + 128).map(c => probe(c)))).find(Boolean);
    if (found) return found;
  }
  return null;
}

// найти сервер в сети, а если его нет — запустить свой
function ensureServer() {
  if (!serverPromise) serverPromise = (async () => {
    const found = await discover();
    if (found) return found;
    try {
      ownServer = require(path.join(APP_DIR, 'server.js'));
      await ownServer.start();
      return 'localhost:' + PORT;
    } catch (e) {
      ownServer = null;
      // порт мог занять сервер, запущенный за это время
      return (await probe('127.0.0.1:' + PORT, 700)) ? 'localhost:' + PORT : null;
    }
  })().catch(() => null);
  return serverPromise;
}

ipcMain.on('sg:ips', e => { e.returnValue = localIps().join(','); });
ipcMain.handle('sg:findServer', async () => {
  const r = await ensureServer();
  if (!r) serverPromise = null; // позволить «Искать снова»
  return r;
});
ipcMain.on('sg:isHost', e => { e.returnValue = !!ownServer; });

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1300, height: 860, minWidth: 900, minHeight: 600,
    title: 'SprintGames',
    backgroundColor: '#0b0e14',
    icon: path.join(APP_DIR, 'icons', 'icon-512.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false // хост продолжает игру, даже если окно свернули
    }
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadFile(path.join(APP_DIR, 'index.html'));
  // F11 — полный экран
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  // ссылки наружу — в обычном браузере, внутри окна только игра
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) e.preventDefault(); });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  ensureServer(); // искать сервер сразу, пока открывается окно
  createWindow();
  // самопроверка для разработчика: SG_SELFTEST=1 electron .
  if (process.env.SG_SELFTEST) win.webContents.once('did-finish-load', async () => {
    try {
      const r = await win.webContents.executeJavaScript(`(async()=>{
        const out={inApp:IN_APP,title:document.title,games:GAMES.map(g=>g.title).join(','),installBtnHidden:document.getElementById('installBtn').style.display==='none'};
        setState('online');
        for(let i=0;i<80&&!(Net.ws&&Net.ws.readyState===1);i++)await new Promise(r=>setTimeout(r,250));
        out.server=document.getElementById('addr').value;out.connected=!!(Net.ws&&Net.ws.readyState===1);out.isHost=SprintApp.isHost();
        createRoom();await new Promise(r=>setTimeout(r,800));
        out.state=state;out.room=Net.room&&Net.room.name;
        return out;
      })()`);
      console.log('SELFTEST ' + JSON.stringify(r));
    } catch (e) { console.log('SELFTEST FAIL ' + e.message); }
    app.exit(0);
  });
});
app.on('window-all-closed', async () => {
  if (ownServer) { try { await ownServer.stop(); } catch { } }
  app.quit();
});
