#!/usr/bin/env bash
# Instala o "aparelho de câmeras" num Lubuntu/Debian já instalado (no pen drive
# ou onde for). Nativo, sem Docker — o mais leve possível pro notebook antigo.
# Sobe MediaMTX (WebRTC ~0,3s) + a interface como serviços, e deixa o Chromium
# abrindo sozinho em tela cheia no boot.
#
# Uso:  sudo bash setup.sh
set -euo pipefail

MTX_VER="v1.19.2"
APP="/opt/cameras"
WEB="$APP/web"
HERE="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="${SUDO_USER:-$(logname 2>/dev/null || echo "$USER")}"

if [ "$(id -u)" -ne 0 ]; then echo "Rode com: sudo bash setup.sh"; exit 1; fi
echo ">> Instalando para o usuário: $USER_NAME"

# ── dependências mínimas ──
apt-get update -y
apt-get install -y --no-install-recommends curl ca-certificates tar python3 \
  chromium || apt-get install -y --no-install-recommends chromium-browser || true

# ── MediaMTX (binário nativo) ──
case "$(uname -m)" in
  x86_64) A=amd64;; aarch64) A=arm64;; armv7l) A=armv7;; *) A=amd64;;
esac
echo ">> Baixando MediaMTX ${MTX_VER} (${A})..."
mkdir -p "$WEB"
curl -fsSL "https://github.com/bluenviron/mediamtx/releases/download/${MTX_VER}/mediamtx_${MTX_VER}_linux_${A}.tar.gz" -o /tmp/mtx.tgz
tar xzf /tmp/mtx.tgz -C /tmp mediamtx
install -m 0755 /tmp/mediamtx "$APP/mediamtx"

# ── config + interface ──
if [ -f "$HERE/cameras.yml" ]; then install -m 0644 "$HERE/cameras.yml" "$APP/cameras.yml";
else install -m 0644 "$HERE/cameras.exemplo.yml" "$APP/cameras.yml"; echo "!! Usei o exemplo — edite $APP/cameras.yml com usuário/senha."; fi
install -m 0644 "$HERE/index.html" "$WEB/index.html"
install -m 0644 "$HERE/cams.json"  "$WEB/cams.json"

# ── serviço: MediaMTX ──
cat >/etc/systemd/system/cameras-mtx.service <<EOF
[Unit]
Description=Cameras MediaMTX (WebRTC)
After=network-online.target
Wants=network-online.target
[Service]
ExecStart=$APP/mediamtx $APP/cameras.yml
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF

# ── serviço: interface web (servidor estático simples) ──
cat >/etc/systemd/system/cameras-ui.service <<EOF
[Unit]
Description=Cameras UI (static)
After=network.target
[Service]
WorkingDirectory=$WEB
ExecStart=/usr/bin/python3 -m http.server 8123 --bind 127.0.0.1
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now cameras-mtx.service cameras-ui.service

# ── autologin (SDDM — padrão do Lubuntu) ──
if command -v sddm >/dev/null 2>&1 || [ -d /etc/sddm.conf.d ]; then
  mkdir -p /etc/sddm.conf.d
  cat >/etc/sddm.conf.d/autologin.conf <<EOF
[Autologin]
User=$USER_NAME
Session=lxqt
EOF
  echo ">> Autologin SDDM configurado (sessão lxqt)."
else
  echo "!! Display manager não é SDDM — configure o autologin manualmente (veja README-LINUX.md)."
fi

# ── quiosque: Chromium em tela cheia no login ──
HOME_DIR="$(getent passwd "$USER_NAME" | cut -d: -f6)"
CHROME="$(command -v chromium || command -v chromium-browser || echo /usr/bin/chromium)"
install -d -o "$USER_NAME" -g "$USER_NAME" "$HOME_DIR/.config/autostart"
cat >"$HOME_DIR/.config/autostart/cameras-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Cameras Kiosk
Exec=bash -c 'sleep 8; exec $CHROME --kiosk --noerrdialogs --disable-infobars --incognito --check-for-update-interval=31536000 --autoplay-policy=no-user-gesture-required http://127.0.0.1:8123'
X-GNOME-Autostart-enabled=true
EOF
chown "$USER_NAME:$USER_NAME" "$HOME_DIR/.config/autostart/cameras-kiosk.desktop"

echo
echo "================================================================"
echo " Instalado. Serviços:  cameras-mtx  e  cameras-ui  (ativos)"
echo " Config das câmeras:   $APP/cameras.yml"
echo " Ver status:           systemctl status cameras-mtx"
echo " Ver logs do vídeo:    journalctl -u cameras-mtx -f"
echo " Reinicie o notebook — ele deve abrir direto nas câmeras."
echo "================================================================"
