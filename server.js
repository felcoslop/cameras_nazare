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
// internet de casa até a VM. HD=true força alta resolução em todas;
// CAM1_HD=true (ou CAM2_HD etc.) força só naquela câmera.
const truthy = v => /^(1|true|yes)$/i.test(v || '');
const USE_HD = truthy(process.env.HD);

// CAM_HOST (opcional): substitui o host das 4 URLs de uma vez.
// Ideal para IP dinâmico: aponte para um hostname DDNS (ex: fulano.ddns.net)
// e nunca mais mexa aqui quando a operadora trocar o IP.
const CAM_HOST = (process.env.CAM_HOST || '').trim();

function prepare(url, forceHd) {
  if (!url) return null;
  let u = (USE_HD || forceHd)
    ? url.replace(/subtype=1/i, 'subtype=0')
    : url.replace(/subtype=0/i, 'subtype=1');
  if (CAM_HOST) {
    // troca só o host (a senha tem o @ codificado como %40, então o @ literal é o separador)
    u = u.replace(/@[^@/]+?:(\d+)/, `@${CAM_HOST}:$1`);
  }
  return u;
}

const cameras = [1, 2, 3, 4].map(n => ({
  id: `cam${n}`,
  url: prepare(process.env[`CAM${n}_URL`], truthy(process.env[`CAM${n}_HD`])),
})).filter(c => c.url);

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
  // API local: usada só pelo watchdog para religar UMA câmera travada
  // sem derrubar as outras (nunca exposta pra fora)
  'api: yes',
  'apiAddress: 127.0.0.1:9997',
  'metrics: no',
  'pprof: no',
  'playback: no',
  'hls: yes',
  `hlsAddress: 127.0.0.1:${HLS_PORT}`,
  "hlsAllowOrigin: '*'",
  'hlsVariant: mpegts',
  'hlsSegmentCount: 10',
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
let mtxProc = null;

function startMediaMTX() {
  console.log(`[mediamtx] Iniciando (${USE_HD ? 'alta res' : 'substream'}, ${cameras.length} câmeras)...`);
  const proc = spawn(MEDIAMTX_BIN, [configPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  mtxProc = proc;

  const logLine = (d) => {
    d.toString().split('\n').forEach(line => {
      if (line.trim()) console.log(`[mediamtx] ${line.trim()}`);
    });
  };
  proc.stdout.on('data', logLine);
  proc.stderr.on('data', logLine);

  proc.on('close', (code) => {
    if (mtxProc === proc) mtxProc = null;
    console.error(`[mediamtx] Encerrado (${code}), reiniciando em 5s...`);
    setTimeout(startMediaMTX, 5000);
  });
}
startMediaMTX();

// ── Watchdog de produção de vídeo ──
// Pega o caso "zumbi": a conexão RTSP fica de pé, mas a câmera para de entregar
// quadros — a playlist HLS congela e a tela fica preta pra sempre. A verificação
// é local (playlist interna), não gera NENHUMA conexão extra com as câmeras.
// Escada de recuperação, sempre suave com as portas do roteador:
//   1. playlist parada por 45s → religa SÓ aquela câmera pela API local
//      (1 reconexão RTSP daquela câmera; as outras não são tocadas);
//   2. religou 2x e continua presa → reinicia o MediaMTX inteiro
//      (no máximo a cada 5 minutos — sem flood);
//   3. mesmo assim presa após 2 reinícios, com outra câmera saudável (prova
//      de que a rede da VM funciona), encerra o processo — o EasyPanel sobe
//      o container limpo, que foi o que resolveu manualmente.
const POLL_MS = 15000;
const STALL_MS = 45000;
const KICK_COOLDOWN_MS = 2 * 60 * 1000;
const MTX_RESTART_COOLDOWN_MS = 5 * 60 * 1000;
const bootTime = Date.now();
let lastMtxRestart = 0;
let watchdogBusy = false;

const camHealth = new Map(cameras.map(c => [c.id, {
  seq: -1, sig: '', lastAdvance: Date.now(),
  lastKick: 0, kicksWhileStalled: 0, restartsWhileStalled: 0,
}]));

function apiRequest(method, apiPath, bodyObj) {
  return new Promise(resolve => {
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const req = http.request(
      {
        host: '127.0.0.1', port: 9997, path: apiPath, method, timeout: 5000,
        headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
      },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode < 300)); }
    );
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    if (body) req.write(body);
    req.end();
  });
}

// Recria só o path da câmera na config do MediaMTX: derruba a conexão RTSP
// presa e abre UMA nova, sem afetar as demais câmeras.
async function kickCamera(cam) {
  await apiRequest('DELETE', `/v3/config/paths/delete/${cam.id}`);
  return apiRequest('POST', `/v3/config/paths/add/${cam.id}`, {
    source: cam.url,
    rtspTransport: 'tcp',
  });
}

function fetchPlaylist(camId) {
  return new Promise(resolve => {
    const req = http.get(
      { host: '127.0.0.1', port: HLS_PORT, path: `/${camId}/index.m3u8`, timeout: 5000 },
      (res) => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => resolve(res.statusCode === 200 ? body : null));
      }
    );
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

setInterval(async () => {
  if (watchdogBusy) return;
  watchdogBusy = true;
  try {
    const bodies = await Promise.all(cameras.map(c => fetchPlaylist(c.id)));
    const now = Date.now();

    cameras.forEach((cam, i) => {
      const h = camHealth.get(cam.id);
      const body = bodies[i];
      if (!body) return;
      const m = body.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
      const seq = m ? parseInt(m[1]) : -1;
      // assinatura pega segmento novo mesmo quando a sequência ainda não girou
      const sig = `${body.length}|${body.slice(-100)}`;
      if (seq !== h.seq || sig !== h.sig) {
        h.seq = seq;
        h.sig = sig;
        h.lastAdvance = now;
        h.kicksWhileStalled = 0;
        h.restartsWhileStalled = 0;
      }
    });

    const stalled = cameras.filter(c => now - camHealth.get(c.id).lastAdvance > STALL_MS);
    if (!stalled.length) return;
    const healthy = cameras.filter(c => now - camHealth.get(c.id).lastAdvance <= STALL_MS);

    // Degrau 1: religa individualmente cada câmera travada (cirúrgico)
    for (const cam of stalled) {
      const h = camHealth.get(cam.id);
      if (h.kicksWhileStalled < 2 && now - h.lastKick > KICK_COOLDOWN_MS) {
        h.lastKick = now;
        h.kicksWhileStalled++;
        console.error(`[watchdog] ${cam.id} sem segmento novo há ${Math.round((now - h.lastAdvance) / 1000)}s — religando só essa câmera (tentativa ${h.kicksWhileStalled}/2)`);
        await kickCamera(cam);
        h.lastAdvance = now; // carência pra reconexão
      }
    }

    // Degraus 2 e 3 só quando religar a câmera sozinha já não resolveu
    const kickExhausted = stalled.filter(c => camHealth.get(c.id).kicksWhileStalled >= 2);
    if (!kickExhausted.length) return;

    const beyondHelp = kickExhausted.filter(c => camHealth.get(c.id).restartsWhileStalled >= 2);
    if (beyondHelp.length && healthy.length && now - bootTime > 15 * 60 * 1000) {
      console.error(`[watchdog] ${beyondHelp.map(c => c.id).join(', ')} sem vídeo mesmo após 2 reinícios do MediaMTX — reiniciando o container`);
      process.exit(1);
    }

    if (now - lastMtxRestart < MTX_RESTART_COOLDOWN_MS) return;
    console.error(`[watchdog] ${kickExhausted.map(c => c.id).join(', ')} continua presa mesmo religada individualmente — reiniciando MediaMTX (reconexão única por câmera)`);
    lastMtxRestart = now;
    kickExhausted.forEach(c => {
      const h = camHealth.get(c.id);
      h.restartsWhileStalled++;
      h.kicksWhileStalled = 0; // libera novos kicks no ciclo seguinte
    });
    cameras.forEach(c => { camHealth.get(c.id).lastAdvance = now; }); // carência pós-reinício
    if (mtxProc) { try { mtxProc.kill(); } catch (_) {} } // supervisor religa em 5s
  } finally {
    watchdogBusy = false;
  }
}, POLL_MS);

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
