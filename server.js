require('dotenv').config();
const express = require('express');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const HTTP_PORT = parseInt(process.env.PORT) || 8080;
const ROTATE_SECONDS = parseInt(process.env.ROTATE_SECONDS) || 10;
const MEDIAMTX_BIN = process.env.MEDIAMTX_PATH || 'mediamtx';
const HLS_PORT = 8888; // interno (127.0.0.1), o express faz proxy

// Por padrão usa o substream (subtype=1): muito mais leve para sair pela
// internet de casa até a VM. Defina HD=true para forçar alta resolução.
const USE_HD = /^(1|true|yes)$/i.test(process.env.HD || '');

// CAM_HOST (opcional): substitui o host das 4 URLs de uma vez.
// Ideal para IP dinâmico: aponte para um hostname DDNS (ex: fulano.ddns.net)
// e nunca mais mexa aqui quando a operadora trocar o IP.
const CAM_HOST = (process.env.CAM_HOST || '').trim();

function prepare(url) {
  if (!url) return null;
  let u = USE_HD
    ? url.replace(/subtype=1/i, 'subtype=0')
    : url.replace(/subtype=0/i, 'subtype=1');
  if (CAM_HOST) {
    // troca só o host (a senha tem o @ codificado como %40, então o @ literal é o separador)
    u = u.replace(/@[^@/]+?:(\d+)/, `@${CAM_HOST}:$1`);
  }
  return u;
}

const cameras = [
  { id: 'cam1', url: prepare(process.env.CAM1_URL) },
  { id: 'cam2', url: prepare(process.env.CAM2_URL) },
  { id: 'cam3', url: prepare(process.env.CAM3_URL) },
  { id: 'cam4', url: prepare(process.env.CAM4_URL) },
].filter(c => c.url);

if (cameras.length === 0) {
  console.error('Nenhuma câmera configurada no .env');
  process.exit(1);
}

// Mostra o endereço EFETIVO de cada câmera (depois do CAM_HOST, senha oculta)
cameras.forEach(c => {
  console.log(`[${c.id}] → ${c.url.replace(/\/\/[^@]*@/, '//***@')}`);
});

// ── Gera a config do MediaMTX ──
// MediaMTX cuida de tudo: conexão RTSP persistente, reconexão automática,
// HLS em memória com sequência contínua (o player nunca se perde).
const mtxConfig = [
  'logLevel: info',
  // Tolera pausas de até 30s no fluxo antes de derrubar a conexão —
  // câmeras em Wi-Fi fraco engasgam por alguns segundos e voltam sozinhas
  'readTimeout: 30s',
  'rtsp: no',
  'rtmp: no',
  'srt: no',
  'webrtc: no',
  'api: no',
  'metrics: no',
  'pprof: no',
  'playback: no',
  'hls: yes',
  `hlsAddress: 127.0.0.1:${HLS_PORT}`,
  "hlsAllowOrigin: '*'",
  'hlsVariant: mpegts',
  'hlsSegmentCount: 7',
  'hlsSegmentDuration: 2s',
  'paths:',
  ...cameras.flatMap(cam => [
    `  ${cam.id}:`,
    `    source: ${cam.url}`,
    '    rtspTransport: tcp',
  ]),
].join('\n') + '\n';

const configPath = path.join(__dirname, 'mediamtx.yml');
fs.writeFileSync(configPath, mtxConfig);

// ── Sobe o MediaMTX (e ressuscita se cair) ──
function startMediaMTX() {
  console.log(`[mediamtx] Iniciando (${USE_HD ? 'alta res' : 'substream'}, ${cameras.length} câmeras)...`);
  const proc = spawn(MEDIAMTX_BIN, [configPath], { stdio: ['ignore', 'pipe', 'pipe'] });

  const logLine = (d) => {
    d.toString().split('\n').forEach(line => {
      if (line.trim()) console.log(`[mediamtx] ${line.trim()}`);
    });
  };
  proc.stdout.on('data', logLine);
  proc.stderr.on('data', logLine);

  proc.on('close', (code) => {
    console.error(`[mediamtx] Encerrado (${code}), reiniciando em 5s...`);
    setTimeout(startMediaMTX, 5000);
  });
}
startMediaMTX();

// ── Web ──
const app = express();

// Proxy: /streams/cam1/index.m3u8 → MediaMTX interno /cam1/index.m3u8
app.use('/streams', (req, res) => {
  const preq = http.request(
    {
      host: '127.0.0.1',
      port: HLS_PORT,
      path: req.url,
      method: 'GET',
      headers: { ...req.headers, host: `127.0.0.1:${HLS_PORT}` },
    },
    (pres) => {
      const headers = { ...pres.headers, 'cache-control': 'no-cache, no-store' };
      res.writeHead(pres.statusCode, headers);
      pres.pipe(res);
    }
  );
  preq.on('error', () => { if (!res.headersSent) res.status(502).end(); });
  preq.end();
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({ cameras: cameras.length, rotateSeconds: ROTATE_SECONDS });
});

app.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`\n=================================`);
  console.log(` Servidor: http://0.0.0.0:${HTTP_PORT}`);
  console.log(` Câmeras: ${cameras.length} (${USE_HD ? 'alta res' : 'substream'})`);
  console.log(`=================================\n`);
});
