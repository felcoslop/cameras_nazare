require('dotenv').config();
const NodeMediaServer = require('node-media-server');
const { spawn } = require('child_process');
const fs = require('fs');

const VM = process.env.PUBLIC_HOST || '162.243.185.189';
const LOCAL_PORT = 1935;
const relays = {};

fs.mkdirSync('./tmp', { recursive: true });

const nms = new NodeMediaServer({
  rtmp: { port: LOCAL_PORT, chunk_size: 60000, gop_cache: true, ping: 30, ping_timeout: 60 },
  http: { port: 8089, allow_origin: '*', mediaroot: './tmp' },
});

nms.on('postPublish', (session) => {
  const streamPath = session.streamPath;
  const id = session.id;

  console.log(`[relay] ${streamPath} recebido → enviando para VM...`);

  const proc = spawn('ffmpeg', [
    '-i', `rtmp://127.0.0.1:${LOCAL_PORT}${streamPath}`,
    '-c', 'copy',
    '-f', 'flv',
    `rtmp://${VM}:1935${streamPath}`,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  proc.stderr.on('data', (d) => {
    const msg = d.toString();
    if (/error|failed/i.test(msg)) console.error(`[relay] ${msg.trim()}`);
  });

  proc.on('close', () => {
    console.log(`[relay] ${streamPath} encerrado`);
    delete relays[id];
  });

  relays[id] = proc;
});

nms.on('donePublish', (session) => {
  if (relays[session.id]) {
    relays[session.id].kill();
    delete relays[session.id];
  }
});

nms.run();

console.log('\n==================================');
console.log(' RELAY LOCAL PRONTO');
console.log('==================================');
console.log(`\nConfigure as câmeras no Mibo → RTMP:`);
for (let i = 1; i <= 4; i++) {
  console.log(`  CAM ${i} → rtmp://192.168.15.8:1935/live/cam${i}`);
}
console.log(`\nStreams repassados para: rtmp://${VM}:1935`);
console.log(`Interface web: https://evolution-cameras-nazare.hfzba0.easypanel.host/\n`);
