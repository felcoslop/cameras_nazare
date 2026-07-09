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
const STALE_MS = 22000;
// Considera a conexão "saudável" se rodou pelo menos esse tempo (reseta o backoff)
const HEALTHY_MS = 40000;
// Backoff: 1ª falha rápida = 5s, depois dobra até no máximo 60s (evita floodar o roteador)
const BASE_RETRY_MS = 5000;
const MAX_RETRY_MS = 60000;

// Por padrão usa o substream (subtype=1): muito mais leve para sair pela internet até a VM.
// O app Mibo é fluido porque roda na rede LOCAL; a VM é remota e depende do upload.
// Defina HD=true no ambiente para forçar alta resolução (subtype=0).
const USE_HD = /^(1|true|yes)$/i.test(process.env.HD || '');

// Cada câmera guarda as duas qualidades. Começa na preferida; se falhar muito,
// alterna para a outra automaticamente (evita ficar preto se o substream não existir).
function build(id, raw) {
  if (!raw) return null;
  return {
    id,
    hd: raw.replace(/subtype=1/i, 'subtype=0'),
    sd: raw.replace(/subtype=0/i, 'subtype=1'),
  };
}

const cameras = [
  build('cam1', process.env.CAM1_URL),
  build('cam2', process.env.CAM2_URL),
  build('cam3', process.env.CAM3_URL),
  build('cam4', process.env.CAM4_URL),
].filter(Boolean);

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

  // Preferência: substream (a menos que HD=true). A cada 3 falhas seguidas, alterna a qualidade.
  const preferSd = !USE_HD;
  const useSd = (Math.floor(failCount / 3) % 2 === 0) ? preferSd : !preferSd;
  const url = useSd ? cam.sd : cam.hd;

  console.log(`[${cam.id}] Conectando (${useSd ? 'substream' : 'alta res'})...`);

  const proc = spawn(FFMPEG, [
    // ── Entrada RTSP ──
    '-rtsp_transport', 'tcp',
    '-timeout', '10000000',        // 10s de timeout de socket: não trava eterno em conexão morta
    '-fflags', '+genpts+discardcorrupt',  // regenera timestamps e DESCARTA pacotes corrompidos
    '-i', url,
    // ── Saída ──
    '-an',
    '-c:v', 'copy',
    '-f', 'hls',
    '-hls_time', '4',              // segmentos maiores toleram GOP grande e perda de pacote
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+append_list',
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
