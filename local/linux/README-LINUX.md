# Notebook como "aparelho de câmeras" (Linux) — passo a passo

Transforma o notebook num monitor dedicado: liga → abre direto nas 4 câmeras,
tela cheia, sem terminal. Nativo (sem Docker), WebRTC ~0,3s. Feito pra ficar
ligado dias — MediaMTX e a interface rodam como serviços que se reiniciam
sozinhos, e cada câmera religa sozinha se cair.

## Por que tem um passo manual

Instalar o sistema operacional exige **dar boot num instalador** — isso não dá
pra fazer pelo Windows. Então o único passo seu é instalar o Lubuntu; todo o
resto (câmeras, quiosque, autologin) é o `setup.sh` deste kit, automático.

## O que você precisa

- **Um pen drive de 16 GB ou mais** para o sistema (8 GB não cabe Lubuntu +
  navegador + cache com folga). O de 8 GB serve só como mídia de instalação.
- Ideal: **dois pen drives** — um para o instalador, outro (16–32 GB) que vira
  o "HD" do sistema. Com um só, você instala no próprio.

## Passo 1 — Criar o instalador do Lubuntu

1. Baixe o Lubuntu 24.04 LTS (arquivo `.iso`): <https://lubuntu.me/downloads/>
2. Baixe o **Rufus**: <https://rufus.ie>
3. No Rufus: selecione o pen drive, aponte a ISO do Lubuntu, grave (modo GPT/UEFI).

## Passo 2 — Instalar o Lubuntu no pen drive de destino

1. Plugue o pen drive de destino (16–32 GB) também.
2. Reinicie o notebook e entre no boot menu (Samsung: **F2** ou **Esc**/**F10**
   ligando; ajuste no BIOS "USB Boot" e desative o "Secure Boot" se travar).
3. Dê boot pelo instalador → "Install Lubuntu".
4. Na hora do disco, escolha **o pen drive de destino** (cuidado pra não marcar
   o HD interno do notebook). Deixe o instalador particionar esse pen drive.
5. Usuário/senha simples (ex.: usuário `nazare`). Anote.
6. Termine e reinicie.

## Passo 3 — Rodar o instalador das câmeras

1. Logue no Lubuntu. Copie esta pasta `linux/` (deste projeto) para o notebook,
   por exemplo para a Área de Trabalho.
2. Confira o `cameras.yml` (IPs/senha das câmeras). Se travar por hardware
   fraco, troque `subtype=0` por `subtype=1` (substream, bem mais leve).
3. Abra o terminal na pasta e rode:
   ```bash
   sudo bash setup.sh
   ```
4. Reinicie. O notebook deve ligar e abrir sozinho nas câmeras, tela cheia.

## Comandos úteis (se precisar)

```bash
systemctl status cameras-mtx        # o servidor de vídeo está de pé?
journalctl -u cameras-mtx -f        # logs ao vivo das conexões RTSP
sudo systemctl restart cameras-mtx  # reiniciar só o vídeo
```
Sair do quiosque: `Ctrl+Alt+F2` (outro terminal) ou `Alt+F4` no Chromium.

## Autologin não pegou?

Se a tela de senha aparecer no boot, o display manager não é o SDDM. No
Lubuntu 24.04 é SDDM e o `setup.sh` já configura. Em outro, edite conforme a
documentação do seu display manager (LightDM: `/etc/lightdm/lightdm.conf`).

---

### Lembrete honesto

Pra esse notebook (2014, 4 GB, Intel HD antiga), o gargalo é **decodificar 4
vídeos**, não o sistema. Linux ajuda um pouco, mas o que mais alivia é usar o
**substream** (`subtype=1`). Se mesmo assim pesar, mostre 1–2 câmeras por vez.
A alternativa sem trocar de sistema é o `CamerasNazare.exe` (pasta `dist/`),
que roda no Windows atual com a mesma latência baixa.
