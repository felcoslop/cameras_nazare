// Empacota tudo (launcher + interface + mediamtx.exe + cameras.yml) num
// executável único do Windows usando o Single Executable Application do Node.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(dir, 'src');
const dist = path.join(dir, 'dist');
fs.mkdirSync(dist, { recursive: true });

const mtx = path.join(dir, 'mediamtx.exe');
const cfg = path.join(dir, 'mediamtx.yml');
for (const [f, msg] of [[mtx, 'mediamtx.exe'], [cfg, 'mediamtx.yml']]) {
  if (!fs.existsSync(f)) { console.error(`Falta ${msg} em ${dir}`); process.exit(1); }
}

const seaConfigPath = path.join(dist, 'sea-config.json');
fs.writeFileSync(seaConfigPath, JSON.stringify({
  main: path.join(src, 'launcher.js'),
  output: path.join(dist, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  assets: {
    'mediamtx.exe': mtx,
    'ui.html': path.join(src, 'ui.html'),
    'cameras.yml': cfg,
  },
}, null, 2));

console.log('1/3 Gerando blob SEA...');
execFileSync(process.execPath, ['--experimental-sea-config', seaConfigPath], { stdio: 'inherit' });

console.log('2/3 Copiando runtime do Node...');
const exe = path.join(dist, 'CamerasNazare.exe');
fs.copyFileSync(process.execPath, exe);

console.log('3/3 Injetando o app no executável...');
const { inject } = await import('postject');
const blob = fs.readFileSync(path.join(dist, 'sea-prep.blob'));
await inject(exe, 'NODE_SEA_BLOB', blob, {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
});

const mb = (fs.statSync(exe).size / 1048576).toFixed(0);
console.log(`\nPRONTO: ${exe} (${mb} MB)`);
