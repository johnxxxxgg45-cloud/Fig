// Painel web protegido por senha
import express from 'express'
import multer from 'multer'
import QRCode from 'qrcode'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TIKTOK_RE, enqueue, withTempDir, buildSticker, downloadTikTok } from './media.js'
import { wa, SUPPORTS_AUDIO_STICKER, startWhatsApp, sendStickerResult, toJid, logout, requestPairing } from './wa.js'

const PASSWORD = process.env.PANEL_PASSWORD
if (!PASSWORD || PASSWORD.length < 6) {
  console.error('Defina a variável PANEL_PASSWORD (mínimo 6 caracteres).')
  process.exit(1)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest()

function auth(req, res, next) {
  const [scheme, b64] = (req.headers.authorization || '').split(' ')
  if (scheme === 'Basic' && b64) {
    const decoded = Buffer.from(b64, 'base64').toString()
    const pass = decoded.slice(decoded.indexOf(':') + 1)
    if (crypto.timingSafeEqual(hash(pass), hash(PASSWORD))) return next()
  }
  res.set('WWW-Authenticate', 'Basic realm="FigSom"').status(401).send('Senha necessária')
}

const app = express()
app.set('trust proxy', 1)
app.get('/health', (_req, res) => res.send('ok')) // sem senha: usado pelo Render e por pings de "manter acordado"
app.use(auth)
app.use(express.static(path.join(__dirname, '../public')))

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 100 * 1024 * 1024 } })

app.get('/api/status', async (_req, res) => {
  const qr = wa.state === 'qr' && wa.qr ? await QRCode.toDataURL(wa.qr, { margin: 1, width: 300 }) : null
  res.json({
    state: wa.state,
    qr,
    me: wa.me ? wa.me.split('@')[0] : null,
    supportsAudioSticker: SUPPORTS_AUDIO_STICKER,
  })
})

app.post('/api/send', upload.single('video'), async (req, res) => {
  const file = req.file
  try {
    const url = String(req.body.url || '').trim()
    if (wa.state !== 'open') return res.status(409).json({ error: 'WhatsApp não está conectado.' })
    if (!file && !url) return res.status(400).json({ error: 'Envie um vídeo ou cole um link do TikTok.' })
    if (!file && !TIKTOK_RE.test(url)) return res.status(400).json({ error: 'Link do TikTok inválido.' })

    const jid = toJid(req.body.to)
    if (!jid) return res.status(400).json({ error: 'Número inválido (use código do país + DDD, só números).' })

    const result = await enqueue(() =>
      withTempDir(async (dir) => {
        const videoPath = file ? file.path : await downloadTikTok(url, dir)
        const built = await buildSticker(videoPath, dir)
        return sendStickerResult(jid, built)
      }),
    )
    res.json({ ok: true, ...result })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Não consegui processar esse vídeo.' })
  } finally {
    if (file) fs.rm(file.path, { force: true }).catch(() => {})
  }
})

app.post('/api/pair', express.json(), async (req, res) => {
  try {
    res.json({ code: await requestPairing(req.body?.phone) })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/logout', async (_req, res) => {
  await logout()
  res.json({ ok: true })
})

const port = process.env.PORT || 3000
app.listen(port, () => console.log(`Painel em http://localhost:${port}`))
startWhatsApp()
