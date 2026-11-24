# FigSom Web 🔊

Painel web + bot que cria **figurinhas com som** (vídeo da galeria ou link do TikTok) e envia pelo seu WhatsApp.

**Não precisa de chip separado:** o servidor entra como *aparelho conectado* no seu número (igual ao WhatsApp Web), lendo um QR code no painel.

## Testar no seu PC
```bash
pip install -U yt-dlp        # só para TikTok; também precisa de ffmpeg
npm install
PANEL_PASSWORD=sua-senha-forte npm start
```
Abra http://localhost:3000 (usuário: qualquer um; senha: a do `PANEL_PASSWORD`).

## Colocar na web (Docker)
O `Dockerfile` já instala ffmpeg e yt-dlp. Em qualquer host que rode Docker (Railway, Fly.io, VPS…):

1. Suba esta pasta (GitHub ou deploy direto).
2. Variáveis de ambiente: `PANEL_PASSWORD` (obrigatória).
3. **Volume persistente montado em `/data`.** Sem ele, a sessão do WhatsApp se perde a cada reinício e você precisa ler o QR de novo.
4. Abra a URL pública (HTTPS), entre com a senha e leia o QR.

Hosts gratuitos costumam "dormir" ou não ter disco persistente: confira as condições atuais antes de escolher.

## Render (plano grátis)

1. Suba esta pasta em um repositório do GitHub.
2. Render → **New → Blueprint** → escolha o repositório (ele lê o `render.yaml`). Informe a `PANEL_PASSWORD` quando pedir.
3. Quando terminar, abra `https://figsom.onrender.com` (ou o endereço mostrado), entre com a senha e conecte o WhatsApp.
4. **Manter acordado:** o plano grátis dorme após 15 min sem acessos. Crie um monitor grátis (ex.: UptimeRobot) chamando `https://SEU-APP.onrender.com/health` a cada 5 minutos.

Limitação: o plano grátis **não tem disco persistente**. Todo reinício ou novo deploy apaga a sessão e você precisa conectar o WhatsApp de novo.

## Usar pelo celular

**Opção A: servidor na web (Android e iPhone).** Faça o deploy acima e abra a URL no navegador do celular (dá para "Adicionar à tela inicial"). Como o QR estaria na mesma tela do WhatsApp, use **"Estou no celular"** no painel: digite seu número, gere o código e coloque em *WhatsApp → Aparelhos conectados → Conectar com número de telefone*.

**Opção B: rodando no próprio Android com Termux (grátis, sem servidor).**
1. Instale o **Termux pelo F-Droid** (a versão da Play Store é antiga).
2. Baixe o `figsom-web.zip`, extraia na pasta Downloads e rode no Termux:
```bash
termux-setup-storage
pkg update && pkg upgrade
pkg install nodejs git ffmpeg python
pip install -U yt-dlp
cp -r ~/storage/downloads/figsom-web ~/ && cd ~/figsom-web
npm install
termux-wake-lock
PANEL_PASSWORD=sua-senha-forte node src/server.js
```
3. Abra `http://localhost:3000` no navegador do celular, use **"Estou no celular"** e conecte com o código.
4. O Android mata apps em segundo plano: deixe o Termux sem restrição de bateria (Configurações → Apps → Termux → Bateria → Sem restrições) e não o feche.

No iPhone só dá a Opção A.

## Usar
- No painel: escolha um vídeo ou cole o link do TikTok, escolha o destino e envie.
- No WhatsApp: mande vídeo com legenda `!figsom`, responda um vídeo com `!figsom` ou `!figsom link-do-tiktok`.
- Limite: 10 s de vídeo/áudio. GIFs não têm som.

## Se a figurinha não chegar com som
O formato é novo e nenhuma biblioteca o suporta oficialmente ainda.
- O painel avisa se a sua versão do Baileys não conhece o formato (então manda figurinha + áudio). Atualize: `npm i @whiskeysockets/baileys@latest`.
- Se suporta mas não chega: rode com `DEBUG=1` e veja o log. Teste também `AUDIO_FORMAT=m4a`.

## Avisos
- Bibliotecas não oficiais podem causar banimento do número. O risco é seu.
- Nunca deixe o painel sem senha: quem acessar usa o seu WhatsApp.
- Baixe do TikTok só conteúdo seu ou com permissão.
