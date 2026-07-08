require('dotenv').config();
const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const HTTP_PORT = parseInt(process.env.PORT) || 8080;
const ROTATE_SECONDS = parseInt(process.env.ROTATE_SECONDS) || 10;
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const STREAMS_DIR = path.join(__dirname, 'streams');

// Reinicia o FFmpeg se a playlist não for atualizada por esse tempo (stream congelado)
const STALE_MS = 15000;
// Considera a conexão "saudável" se rodou pelo menos esse tempo (reseta o backoff)
const HEALTHY_MS = 40000;
// Backoff: 1ª falha rápida = 5s, depois dobra até no máximo 60s (evita floodar o roteador)
const BASE_RETRY_MS = 5000;
const MAX_RETRY_MS = 60000;

// USE_SUBSTREAM=true troca subtype=0 (alta) por subtype=1 (baixa) — corta muito a banda
const USE_SUBSTREAM = /^(1|true|yes)$/i.test(process.env.USE_SUBSTREAM || '');
function applyStream(url) {
  if (!url) return url;
  return USE_SUBSTREAM ? url.replace(/subtype=0/i, 'subtype=1') : url;
}

const cameras = [
  { id: 'cam1', url: applyStream(process.env.CAM1_URL) },
  { id: 'cam2', url: applyStream(process.env.CAM2_URL) },
  { id: 'cam3', url: applyStream(process.env.CAM3_URL) },
  { id: 'cam4', url: applyStream(process.env.CAM4_URL) },
].filter(c => c.url);

if (cameras.length === 0) {
  console.error('Nenhuma câmera configurada no .env');
  process.exit(1);
}

cameras.forEach(c => fs.mkdirSync(path.join(STREAMS_DIR, c.id), { recursive: true }));

function startFFmpeg(cam, failCount = 0) {
  const outDir = path.join(STREAMS_DIR, cam.id);
  const playlist = path.join(outDir, 'index.m3u8');
  const segPattern = path.join(outDir, 'seg%03d.ts');
  const startedAt = Date.now();
  let killedByWatchdog = false;

  console.log(`[${cam.id}] Conectando...`);

  const proc = spawn(FFMPEG, [
    // ── Entrada RTSP ──
    '-rtsp_transport', 'tcp',
    '-timeout', '10000000',        // 10s de timeout de socket: não trava eterno em conexão morta
    '-fflags', 'nobuffer',
    '-i', cam.url,
    // ── Saída ──
    '-an',
    '-c:v', 'copy',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '5',         // janela maior = absorve oscilação de banda sem congelar
    '-hls_flags', 'delete_segments+append_list+omit_endlist',
    '-hls_segment_filename', segPattern,
    playlist,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  proc.stderr.on('data', (d) => {
    const msg = d.toString();
    if (/error|failed/i.test(msg)) {
      console.error(`[${cam.id}] ${msg.trim().split('\n').pop()}`);
    }
  });

  // Watchdog: se a playlist parar de ser atualizada, o stream congelou → mata e reinicia
  const watchdog = setInterval(() => {
    try {
      const stat = fs.statSync(playlist);
      if (Date.now() - stat.mtimeMs > STALE_MS) {
        console.log(`[${cam.id}] Congelado (${STALE_MS / 1000}s sem atualizar), reiniciando...`);
        killedByWatchdog = true;
        proc.kill('SIGKILL');
      }
    } catch (_) {
      // playlist ainda não existe: se demorou demais pra criar, reinicia
      if (Date.now() - startedAt > STALE_MS) {
        killedByWatchdog = true;
        proc.kill('SIGKILL');
      }
    }
  }, 5000);

  proc.on('close', (code) => {
    clearInterval(watchdog);
    const ranFor = Date.now() - startedAt;
    // Se rodou tempo suficiente, foi uma conexão saudável que caiu → reseta o backoff
    const nextFail = ranFor > HEALTHY_MS ? 0 : failCount + 1;
    const delay = Math.min(BASE_RETRY_MS * Math.pow(2, nextFail), MAX_RETRY_MS);
    const reason = killedByWatchdog ? 'congelado' : `código ${code}`;
    console.log(`[${cam.id}] Encerrado (${reason}) após ${Math.round(ranFor / 1000)}s, reiniciando em ${delay / 1000}s...`);
    setTimeout(() => startFFmpeg(cam, nextFail), delay);
  });
}

cameras.forEach(cam => startFFmpeg(cam));

const app = express();

app.use('/streams', express.static(STREAMS_DIR, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    } else if (filePath.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/mp2t');
    }
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
  },
}));

// Silencia o erro chato de "Range Not Satisfiable" quando o player pede um segmento já deletado
app.use((err, req, res, next) => {
  if (err && err.status === 416) return res.status(416).end();
  next(err);
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({ cameras: cameras.length, rotateSeconds: ROTATE_SECONDS });
});

app.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`\n=================================`);
  console.log(` Servidor: http://0.0.0.0:${HTTP_PORT}`);
  console.log(` Câmeras: ${cameras.length}`);
  console.log(`=================================\n`);
});
