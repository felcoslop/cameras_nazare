require('dotenv').config();
const NodeMediaServer = require('node-media-server');
const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const HTTP_PORT = parseInt(process.env.PORT) || 8080;
const RTMP_PORT = 1935;
const ROTATE_SECONDS = parseInt(process.env.ROTATE_SECONDS) || 10;
const STREAMS_DIR = path.join(__dirname, 'streams', 'live');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

fs.mkdirSync(STREAMS_DIR, { recursive: true });

function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

const LOCAL_IP = process.env.PUBLIC_HOST || getLocalIP();
const activeSessions = {};

// Servidor RTMP
const nms = new NodeMediaServer({
  rtmp: {
    port: RTMP_PORT,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60,
  },
  http: {
    port: 8088,
    allow_origin: '*',
    mediaroot: STREAMS_DIR,
  },
});

// Quando câmera começa a transmitir → inicia FFmpeg → gera HLS
nms.on('postPublish', (session) => {
  const streamPath = session.streamPath;
  const id = session.id;
  const name = streamPath.replace(/^\/live\//, '');
  const outDir = path.join(STREAMS_DIR, name);
  fs.mkdirSync(outDir, { recursive: true });

  const playlist = path.join(outDir, 'index.m3u8');
  const segPattern = path.join(outDir, 'seg%03d.ts');

  console.log(`[${name}] Câmera conectada, iniciando HLS...`);

  const proc = spawn(FFMPEG, [
    '-i', `rtmp://127.0.0.1:${RTMP_PORT}${streamPath}`,
    '-c', 'copy',
    '-f', 'hls',
    '-hls_time', '1',
    '-hls_list_size', '3',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_filename', segPattern,
    playlist,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  proc.stderr.on('data', (d) => {
    const msg = d.toString();
    if (/error|failed/i.test(msg)) {
      console.error(`[${name}] ${msg.trim().split('\n').pop()}`);
    }
  });

  proc.on('close', () => {
    console.log(`[${name}] FFmpeg encerrado`);
    delete activeSessions[id];
  });

  activeSessions[id] = proc;
});

nms.on('donePublish', (session) => {
  const id = session.id;
  const name = session.streamPath.replace(/^\/live\//, '');
  console.log(`[${name}] Câmera desconectada`);
  if (activeSessions[id]) {
    activeSessions[id].kill('SIGTERM');
    delete activeSessions[id];
  }
});

nms.run();

// Servidor web
const app = express();

app.use('/streams', express.static(STREAMS_DIR, {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
  },
}));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({ cameras: 4, rotateSeconds: ROTATE_SECONDS });
});

app.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log('\n==================================');
  console.log(` Acesse: http://${LOCAL_IP}:${HTTP_PORT}`);
  console.log('==================================');
  console.log('\nConfigure cada câmera no app Mibo → RTMP → Personalizado:');
  for (let i = 1; i <= 4; i++) {
    console.log(`  CAM ${i} → URL RTMP: rtmp://${LOCAL_IP}:${RTMP_PORT}/live/cam${i}`);
  }
  console.log('');
});
