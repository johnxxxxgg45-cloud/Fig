FROM node:22-slim

# git: o Baileys puxa dependências direto do GitHub
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ffmpeg python3 python3-pip ca-certificates \
 && pip3 install --no-cache-dir --break-system-packages -U yt-dlp \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

# Monte um volume persistente em /data, senão a sessão do WhatsApp se perde a cada reinício
ENV AUTH_DIR=/data/auth
EXPOSE 3000
CMD ["node", "src/server.js"]
