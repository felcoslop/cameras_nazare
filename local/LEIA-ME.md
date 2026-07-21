# Versão local (mesma rede das câmeras) — tempo real

Roda no computador de casa, na mesma rede Wi-Fi das câmeras. Usa WebRTC em vez
de HLS: latência de **~0,3 segundo** (contra 6–10s da versão da VM) e, como as
4 câmeras chegam em tempo real, a sincronia entre elas é exata por natureza.
Na LAN dá pra usar o **main stream em HD** (subtype=0) sem medo de banda.

## Como usar

1. Baixe o MediaMTX para Windows (arquivo `mediamtx_vX.X.X_windows_amd64.zip`)
   em <https://github.com/bluenviron/mediamtx/releases>, extraia e coloque o
   `mediamtx.exe` **nesta pasta** (só precisa fazer isso uma vez).
2. Confira o `mediamtx.yml`: os IPs das câmeras (192.168.15.3 a .6) e a senha.
   Se este arquivo não existir (veio do GitHub), copie de `mediamtx.exemplo.yml`
   e preencha usuário/senha (o `@` da senha vira `%40`).
3. Dê dois cliques em `start.bat`. Ele sobe o MediaMTX e abre a grade no
   navegador. Clique numa câmera = tela cheia; ESC volta pra grade.

## Avisos

- **Não suba o `mediamtx.yml` preenchido pro GitHub** — ele tem a senha das
  câmeras (já está no `.gitignore`).
- A versão local soma **1 conexão a mais por câmera** além da que a VM já usa.
  As Mibo têm limite de "Acesso simultâneo" (configurável no app Mibo) — se
  alguma câmera começar a derrubar conexões com os dois rodando + gente no
  app, é esse limite.
- Cada tela tem vigia próprio: sem quadro novo por 8s, religa sozinha a
  conexão daquela câmera (com recuo progressivo, sem flood).

## Bônus: teste definitivo da câmera 4

Se a cam4 engasgar **até aqui** (rodando local, sem internet no caminho), o
problema é 100% o rádio Wi-Fi dela (câmera externa, parede, 2,4 GHz) — cabo
RJ-45 ou repetidor resolve. Se aqui ela rodar lisa, o gargalo é o caminho de
upload até a VM.
