require('dotenv').config();
const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const HTTP_PORT = parseInt(process.env.PORT) || 8080;
const ROTATE_SECONDS = parseInt(process.env.ROTATE_SECONDS) || 10;
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const STREAMS_DIR = path.join(__dirname, 'streams');

const cameras = [
  { id: 'cam1', url: process.env.CAM1_URL },
  { id: 'cam2', url: process.env.CAM2_URL },
  { id: 'cam3', url: process.env.CAM3_URL },
  { id: 'cam4', url: process.env.CAM4_URL },
].filter(c => c.url);

if (cameras.length === 0) {
  console.error('Nenhuma câmera configurada no .env');
  process.exit(1);
}

cameras.forEach(c => fs.mkdirSync(path.join(STREAMS_DIR, c.id), { recursive: true }));

function startFFmpeg(cam) {
  const outDir = path.join(STREAMS_DIR, cam.id);
  const playlist = path.join(outDir, 'index.m3u8');
  const segPattern = path.join(outDir, 'seg%03d.ts');

  console.log(`[${cam.id}] Conectando...`);

  const proc = spawn(FFMPEG, [
    '-fflags', 'nobuffer',
    '-rtsp_transport', 'tcp',
    '-i', cam.url,
    '-c:v', 'copy',
    '-an',
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
      console.error(`[${cam.id}] ${msg.trim().split('\n').pop()}`);
    }
  });

  proc.on('close', (code) => {
    console.log(`[${cam.id}] Encerrado (${code}), reiniciando em 15s...`);
    setTimeout(() => startFFmpeg(cam), 15000);
  });
}

cameras.forEach(startFFmpeg);

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
