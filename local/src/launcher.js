'use strict';
// Câmeras Nazaré — versão LOCAL (LAN), executável único.
// Sobe o MediaMTX embutido, supervisiona (reinicia se cair), serve a
// interface WebRTC e abre o navegador. Feito pra ficar rodando dias sem
// intervenção. Latência ~0,3s (tempo real), sincronia natural.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, exec } = require('child_process');

// ── Assets: embutidos no .exe (SEA) ou lidos do disco (rodando via node) ──
let sea = null;
try { sea = require('node:sea'); } catch (_) {}
const inSea = !!(sea && sea.isSea && sea.isSea());

function assetBuffer(name, diskPath) {
  if (inSea) return Buffer.from(sea.getAsset(name));
  return fs.readFileSync(diskPath);
}
function assetText(name, diskPath) {
  if (inSea) return sea.getAsset(name, 'utf8');
  return fs.readFileSync(diskPath, 'utf8');
}

// ── Pasta de trabalho: ao lado do executável ──
const baseDir = inSea ? path.dirname(process.execPath) : __dirname;
const workDir = path.join(baseDir, 'cameras-data');
try { fs.mkdirSync(workDir, { recursive: true }); } catch (_) {}

const mtxPath = path.join(workDir, 'mediamtx.exe');
const cfgPath = path.join(workDir, 'cameras.yml');   // editável pelo usuário
const logPath = path.join(workDir, 'cameras.log');

// mediamtx.exe: grava na primeira vez (ou se o tamanho mudou = build novo)
(function ensureMtx() {
  const buf = assetBuffer('mediamtx.exe', path.join(__dirname, '..', 'mediamtx.exe'));
  let need = true;
  try { need = fs.statSync(mtxPath).size !== buf.length; } catch (_) {}
  if (need) {
    try { fs.writeFileSync(mtxPath, buf); }
    catch (e) { /* pode estar em uso por uma instância anterior — segue com o existente */ }
  }
})();

// cameras.yml: grava o padrão só se ainda não existir (edições do usuário mandam)
if (!fs.existsSync(cfgPath)) {
  fs.writeFileSync(cfgPath, assetText('cameras.yml', path.join(__dirname, '..', 'mediamtx.yml')));
}

// ── Descobre nomes das câmeras e a porta WebRTC a partir do cameras.yml ──
function readConfig() {
  const yml = fs.readFileSync(cfgPath, 'utf8');
  const cams = [];
  const pathsIdx = yml.indexOf('\npaths:');
  const section = pathsIdx >= 0 ? yml.slice(pathsIdx) : yml;
  const re = /^\s{2}([A-Za-z0-9_]+):\s*$/gm;
  let m;
  while ((m = re.exec(section))) cams.push(m[1]);
  const pm = yml.match(/webrtcAddress:\s*:?(\d+)/);
  const webrtcPort = pm ? parseInt(pm[1]) : 8889;
  return { cams, webrtcPort };
}

// ── Log com teto (não cresce pra sempre em execuções de dias) ──
const LOG_CAP = 3 * 1024 * 1024;
function log(line) {
  const s = `[${new Date().toISOString()}] ${line}\n`;
  try {
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > LOG_CAP) {
      const tail = fs.readFileSync(logPath).slice(-LOG_CAP / 2);
      fs.writeFileSync(logPath, tail);
    }
    fs.appendFileSync(logPath, s);
  } catch (_) {}
  process.stdout.write(s);
}

// ── Supervisor do MediaMTX: reinicia se cair, com recuo suave ──
let mtx = null;
let shuttingDown = false;
let restartDelay = 2000;

function startMtx() {
  if (shuttingDown) return;
  log('Iniciando MediaMTX...');
  mtx = spawn(mtxPath, [cfgPath], { cwd: workDir, windowsHide: true });
  const pipe = d => d.toString().split('\n').forEach(l => l.trim() && log(`[mtx] ${l.trim()}`));
  mtx.stdout.on('data', pipe);
  mtx.stderr.on('data', pipe);
  mtx.on('spawn', () => { restartDelay = 2000; });
  mtx.on('exit', (code) => {
    mtx = null;
    if (shuttingDown) return;
    log(`MediaMTX saiu (código ${code}). Reiniciando em ${restartDelay / 1000}s...`);
    setTimeout(startMtx, restartDelay);
    restartDelay = Math.min(restartDelay * 1.5, 15000);
  });
  mtx.on('error', (e) => log(`Erro ao iniciar MediaMTX: ${e.message}`));
}

// ── Servidor web local: entrega a interface e a lista de câmeras ──
const uiHtml = assetText('ui.html', path.join(__dirname, 'ui.html'));

function serve(port, onFail) {
  const srv = http.createServer((req, res) => {
    if (req.url === '/' || req.url.startsWith('/index')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(uiHtml);
    }
    if (req.url.startsWith('/api/cams')) {
      const { cams, webrtcPort } = readConfig();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ cams, webrtcPort }));
    }
    res.writeHead(404); res.end('nao encontrado');
  });
  srv.on('error', (e) => {
    if (e.code === 'EADDRINUSE') onFail();
    else log(`Erro no servidor web: ${e.message}`);
  });
  srv.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    log(`Interface pronta em ${url}`);
    openBrowser(url);
    banner(url);
  });
}

// tenta portas em sequência (caso 8123 já esteja ocupada)
const PORTS = [8123, 8124, 8125, 8126, 8127];
(function tryServe(i) {
  if (i >= PORTS.length) { log('Nenhuma porta livre para a interface.'); return; }
  serve(PORTS[i], () => tryServe(i + 1));
})(0);

function openBrowser(url) {
  // Windows: 'start' abre no navegador padrão
  exec(`start "" "${url}"`, { shell: 'cmd.exe' }, () => {});
}

function banner(url) {
  const { cams } = readConfig();
  const line = '='.repeat(46);
  process.stdout.write(
    `\n${line}\n  Câmeras Nazaré — LOCAL (tempo real)\n` +
    `  Abrindo no navegador: ${url}\n` +
    `  Câmeras: ${cams.join(', ') || '(nenhuma no cameras.yml)'}\n` +
    `  Config editável: ${cfgPath}\n` +
    `  Para sair: feche esta janela.\n${line}\n\n`
  );
}

// ── Encerramento limpo ──
function shutdown() {
  shuttingDown = true;
  if (mtx) { try { mtx.kill(); } catch (_) {} }
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);

startMtx();
