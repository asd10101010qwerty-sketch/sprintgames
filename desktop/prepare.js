// Копирует игру и сервер в desktop/app перед запуском или сборкой программы.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), APP = path.join(__dirname, 'app'), RES = path.join(__dirname, 'buildres');
fs.rmSync(APP, { recursive: true, force: true });
fs.mkdirSync(path.join(APP, 'icons'), { recursive: true });
fs.mkdirSync(RES, { recursive: true });
for (const f of ['index.html', 'server.js', 'manifest.webmanifest', 'sw.js']) fs.copyFileSync(path.join(ROOT, f), path.join(APP, f));
for (const f of fs.readdirSync(path.join(ROOT, 'icons'))) fs.copyFileSync(path.join(ROOT, 'icons', f), path.join(APP, 'icons', f));
// APK кладём внутрь, чтобы программа-сервер могла раздавать Android-приложение телефонам
if (fs.existsSync(path.join(ROOT, 'SprintGames.apk'))) fs.copyFileSync(path.join(ROOT, 'SprintGames.apk'), path.join(APP, 'SprintGames.apk'));
fs.copyFileSync(path.join(ROOT, 'icons', 'icon-512.png'), path.join(RES, 'icon.png'));
console.log('Файлы игры подготовлены в desktop/app');
