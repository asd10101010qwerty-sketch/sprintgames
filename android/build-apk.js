// Сборка Android-приложения SprintGames без Android Studio и Gradle.
// Запуск из папки игры:  node android/build-apk.js
// Нужно: JDK (java, javac, jar, keytool) и Android SDK: build-tools/34.0.0, platforms/android-34.
// Результат: SprintGames.apk в папке игры (его же отдаёт server.js по адресу /SprintGames.apk).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawnSync } = require('child_process');
const { androidIcons } = require('../gen-icons.js');

const ROOT = path.join(__dirname, '..');
const SDK = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || 'C:/Users/User/android-sdk';
const BT = path.join(SDK, 'build-tools', '34.0.0');
const JAR = path.join(SDK, 'platforms', 'android-34', 'android.jar');
const OUT = path.join(__dirname, 'build');
const pkg = require('../package.json');
const VERSION_NAME = pkg.version;
const VERSION_CODE = String(Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 60000)); // растёт с каждой сборкой

// JDK: jar и keytool обычно не лежат в PATH, ищем папку JDK
function findJdk() {
  const cands = [];
  if (process.env.JAVA_HOME) cands.push(process.env.JAVA_HOME);
  for (const base of ['C:/Program Files/Java', 'C:/Program Files/Eclipse Adoptium', 'C:/Program Files/Microsoft'])
    if (fs.existsSync(base)) for (const d of fs.readdirSync(base).filter(d => /^jdk/i.test(d)).sort().reverse()) cands.push(path.join(base, d));
  for (const c of cands) if (fs.existsSync(path.join(c, 'bin', 'jar.exe')) || fs.existsSync(path.join(c, 'bin', 'jar'))) return path.join(c, 'bin');
  console.error('Не найден JDK (нужны javac, jar, keytool). Укажите JAVA_HOME.'); process.exit(1);
}
const JDK = findJdk();
const tool = n => path.join(JDK, n + (process.platform === 'win32' ? '.exe' : ''));

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', shell: /\.bat$/i.test(cmd), ...opts });
  if (r.status !== 0) {
    console.error(`\nОшибка: ${path.basename(cmd)} ${args.join(' ')}\n${r.stdout || ''}${r.stderr || ''}${r.error || ''}`);
    process.exit(1);
  }
  return (r.stdout || '') + (r.stderr || '');
}
const step = t => console.log('-> ' + t);
function copyDir(a, b) {
  fs.mkdirSync(b, { recursive: true });
  for (const e of fs.readdirSync(a, { withFileTypes: true })) {
    const s = path.join(a, e.name), d = path.join(b, e.name);
    e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}
function listFiles(dir, ext, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, ext, acc); else if (p.endsWith(ext)) acc.push(p);
  }
  return acc;
}

for (const f of [BT, JAR]) if (!fs.existsSync(f)) { console.error('Не найден Android SDK: ' + f); process.exit(1); }
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

step('ресурсы и иконки');
const RES = path.join(OUT, 'res');
copyDir(path.join(__dirname, 'res'), RES);
androidIcons(RES);

step('игра внутрь приложения (assets)');
const WWW = path.join(OUT, 'assets', 'www');
fs.mkdirSync(path.join(WWW, 'icons'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(WWW, 'index.html'));
fs.copyFileSync(path.join(ROOT, 'manifest.webmanifest'), path.join(WWW, 'manifest.webmanifest'));
for (const f of fs.readdirSync(path.join(ROOT, 'icons'))) fs.copyFileSync(path.join(ROOT, 'icons', f), path.join(WWW, 'icons', f));

step('aapt2: компиляция ресурсов');
const AAPT2 = path.join(BT, 'aapt2.exe');
run(AAPT2, ['compile', '--dir', RES, '-o', path.join(OUT, 'res.zip')]);

step('aapt2: сборка пакета');
const GEN = path.join(OUT, 'gen'), BASE = path.join(OUT, 'base.apk');
fs.mkdirSync(GEN);
run(AAPT2, ['link', '-I', JAR, '--manifest', path.join(__dirname, 'AndroidManifest.xml'),
  '--java', GEN,
  '--min-sdk-version', '24', '--target-sdk-version', '34',
  '--version-code', VERSION_CODE, '--version-name', VERSION_NAME,
  '-o', BASE, path.join(OUT, 'res.zip')]);

step('javac: компиляция кода');
const CLASSES = path.join(OUT, 'classes');
fs.mkdirSync(CLASSES);
const javaFiles = [...listFiles(path.join(__dirname, 'src'), '.java'), ...listFiles(GEN, '.java')];
run(tool('javac'), ['--release', '8', '-parameters', '-encoding', 'UTF-8', '-nowarn', '-Xlint:-options', '-cp', JAR, '-d', CLASSES, ...javaFiles]);

step('d8: перевод в формат Android (dex)');
const DEX = path.join(OUT, 'dex');
fs.mkdirSync(DEX);
run(path.join(BT, 'd8.bat'), ['--release', '--min-api', '24', '--lib', JAR, '--output', DEX, ...listFiles(CLASSES, '.class')]);

step('упаковка classes.dex и файлов игры');
// файлы игры добавляем через jar: aapt2 в Windows записывает пути assets с обратной косой чертой
run(tool('jar'), ['--update', '--no-manifest', '--file', BASE, '-C', DEX, 'classes.dex', '-C', OUT, 'assets']);

step('zipalign');
const ALIGNED = path.join(OUT, 'aligned.apk');
run(path.join(BT, 'zipalign.exe'), ['-p', '-f', '4', BASE, ALIGNED]);

step('подпись');
// ключ подписи хранится локально и НЕ попадает в git: без него нельзя будет выпускать обновления поверх
const KS = path.join(__dirname, 'sprintgames.jks'), KP = path.join(__dirname, 'keystore.properties');
if (!fs.existsSync(KS)) {
  const pass = crypto.randomBytes(18).toString('base64url');
  run(tool('keytool'), ['-genkeypair', '-keystore', KS, '-storetype', 'PKCS12', '-alias', 'sprintgames', '-keyalg', 'RSA', '-keysize', '2048',
    '-validity', '10000', '-storepass', pass, '-keypass', pass, '-dname', 'CN=SprintGames, O=SprintGames']);
  fs.writeFileSync(KP, 'storePassword=' + pass + '\n');
  console.log('   создан новый ключ подписи: android/sprintgames.jks (сохраните его!)');
}
const PASS = fs.readFileSync(KP, 'utf8').match(/storePassword=(.+)/)[1].trim();
const FINAL = path.join(ROOT, 'SprintGames.apk');
run(path.join(BT, 'apksigner.bat'), ['sign', '--ks', KS, '--ks-key-alias', 'sprintgames', '--ks-pass', 'pass:' + PASS, '--key-pass', 'pass:' + PASS, '--out', FINAL, ALIGNED]);
run(path.join(BT, 'apksigner.bat'), ['verify', FINAL]);

const kb = (fs.statSync(FINAL).size / 1024).toFixed(0);
console.log(`\nГотово: SprintGames.apk (${kb} КБ), версия ${VERSION_NAME} (${VERSION_CODE})`);
