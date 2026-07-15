# cameras_nazare

Sistema de **transmissão ao vivo de câmeras IP** pela internet. Pega o fluxo RTSP/RTMP de câmeras (ex.: 4 câmeras de um imóvel em Nazaré) e disponibiliza uma interface web para assistir de qualquer lugar, sem precisar abrir portas na rede local.

O projeto tem duas peças:

## 1. `server.js` — Servidor de visualização (roda na VM/nuvem)

- Usa o **MediaMTX** para se conectar às câmeras via RTSP, com reconexão automática, e converte o fluxo para **HLS** (compatível com navegador/celular).
- O Express faz proxy do HLS interno e serve a interface web (`public/index.html`), que alterna entre as câmeras em modo rotativo.
- Por padrão consome o **substream** (menor resolução) das câmeras para economizar banda; dá para forçar HD por câmera ou global.
- Suporta **host dinâmico** (`CAM_HOST`) para apontar para um DDNS quando o IP da operadora muda.

## 2. `relay.js` — Relay local (roda perto das câmeras)

- Sobe um servidor **RTMP** local (`node-media-server`) que recebe o fluxo das câmeras (ex.: câmeras Mibo configuradas para publicar em `rtmp://IP-local:1935/live/camN`).
- Usa **ffmpeg** para repassar (`-c copy`) cada fluxo para a VM pública, sem re-encodar.
- Reinicia sozinho os relays que caírem.

```
Câmeras (RTSP/RTMP) ──▶ relay.js (rede local) ──▶ VM: server.js (MediaMTX → HLS) ──▶ Navegador
```

## Variáveis de ambiente (`.env`)

| Variável | Descrição |
|----------|-----------|
| `PORT` | Porta do servidor web (padrão `8080`). |
| `ROTATE_SECONDS` | Segundos por câmera no modo rotativo (padrão `10`). |
| `CAM1_URL` … `CAM4_URL` | URLs RTSP de cada câmera. |
| `CAM1_HD` … `CAM4_HD` | Força alta resolução naquela câmera (`true`). |
| `HD` | Força alta resolução em todas as câmeras. |
| `CAM_HOST` | Substitui o host das URLs (ideal para DDNS com IP dinâmico). |
| `MEDIAMTX_PATH` | Caminho do binário do MediaMTX (padrão: `mediamtx` no PATH). |
| `PUBLIC_HOST` | IP/domínio público da VM (usado pelo `relay.js`). |

Veja `.env.example` como base.

## Como rodar

**Servidor de visualização** (precisa do binário do MediaMTX disponível):

```bash
npm install
node server.js
# Interface em http://localhost:8080
```

**Relay local** (precisa de ffmpeg instalado):

```bash
npm install
node relay.js
```

## Deploy

Inclui `Dockerfile` e `docker-compose.yml` para subir o servidor de visualização em container (ex.: Easypanel/VPS).

## Stack

- Node.js + Express
- [MediaMTX](https://github.com/bluenviron/mediamtx) (RTSP → HLS)
- `node-media-server` (servidor RTMP)
- ffmpeg (repasse de fluxo)
- `dotenv`
