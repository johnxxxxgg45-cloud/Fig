// Conexão com o WhatsApp (Baileys) como "aparelho conectado" do seu próprio número
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  normalizeMessageContent,
  jidNormalizedUser,
  proto,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  AUDIO_MIME, CFG, TIKTOK_RE,
  enqueue, withTempDir, buildSticker, downloadTikTok,
} from './media.js'

const logger = pino({ level: process.env.DEBUG ? 'debug' : 'silent' })
const AUTH_DIR = process.env.AUTH_DIR || 'auth'
const COMMANDS = ['!figsom', '!fs', '!tiktok']

export const wa = { sock: null, state: 'connecting', qr: null, me: null }

// O Baileys só envia figurinha com som se o protocolo da versão instalada conhece estes campos.
export const SUPPORTS_AUDIO_STICKER =
  'audioStickerMessage' in proto.Message.prototype &&
  'audioMessage' in (proto.Message.StickerMessage?.prototype ?? {})

export function toJid(to) {
  if (!wa.sock?.user) return null
  if (!to || to === 'me') return jidNormalizedUser(wa.sock.user.id)
  const digits = String(to).replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15) return null
  return `${digits}@s.whatsapp.net`
}

// Estrutura descoberta pela comunidade (PR #2110 do whatsapp-rust):
// audioStickerMessage > message > stickerMessage (+ audioMessage dentro)
async function sendAudioSticker(jid, webp, audio, seconds) {
  const sock = wa.sock
  const opts = { upload: sock.waUploadToServer }

  const { stickerMessage } = await prepareWAMessageMedia({ sticker: webp, isAnimated: true }, opts)
  const { audioMessage } = await prepareWAMessageMedia(
    { audio, mimetype: AUDIO_MIME, ptt: false, seconds: Math.round(seconds) },
    opts,
  )
  stickerMessage.audioMessage = audioMessage

  const full = generateWAMessageFromContent(
    jid,
    { audioStickerMessage: { message: { stickerMessage } } },
    { userJid: sock.user.id },
  )
  await sock.relayMessage(jid, full.message, { messageId: full.key.id })
}

export async function sendStickerResult(jid, built) {
  const sock = wa.sock
  const info = { trimmed: built.trimmed, seconds: Math.round(built.seconds) }

  if (!built.hasAudio) {
    await sock.sendMessage(jid, { sticker: built.webp })
    return { mode: 'sticker-only', ...info }
  }
  if (SUPPORTS_AUDIO_STICKER) {
    await sendAudioSticker(jid, built.webp, built.audio, built.seconds)
    return { mode: 'audio-sticker', ...info }
  }
  await sock.sendMessage(jid, { sticker: built.webp })
  await sock.sendMessage(jid, { audio: built.audio, mimetype: AUDIO_MIME, ptt: CFG.audioFormat === 'ogg' })
  return { mode: 'sticker+audio', ...info }
}

// ---------- comandos dentro do WhatsApp (!figsom) ----------
async function getVideoBuffer(msg) {
  const content = normalizeMessageContent(msg.message)
  let target = null
  if (content?.videoMessage) {
    target = msg
  } else {
    const ctx = content?.extendedTextMessage?.contextInfo
    const quoted = ctx?.quotedMessage && normalizeMessageContent(ctx.quotedMessage)
    if (quoted?.videoMessage) {
      target = {
        key: { remoteJid: msg.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant },
        message: ctx.quotedMessage,
      }
    }
  }
  if (!target) return null
  return downloadMediaMessage(target, 'buffer', {}, { logger, reuploadRequest: wa.sock.updateMediaMessage })
}

async function handleCommand(msg) {
  const jid = msg.key.remoteJid
  if (!msg.message || !jid || jid === 'status@broadcast') return

  const content = normalizeMessageContent(msg.message)
  const text = (
    content?.conversation ??
    content?.extendedTextMessage?.text ??
    content?.videoMessage?.caption ??
    ''
  ).trim()
  const [cmd = '', arg = ''] = text.split(/\s+/)
  if (!COMMANDS.includes(cmd.toLowerCase())) return

  const say = (t) => wa.sock.sendMessage(jid, { text: t }, { quoted: msg })

  try {
    await withTempDir(async (dir) => {
      let videoPath = path.join(dir, 'in.mp4')
      if (arg) {
        if (!TIKTOK_RE.test(arg)) return say('Link inválido. Mande um link do TikTok ou envie um vídeo.')
        await say('⏳ Baixando do TikTok...')
        videoPath = await downloadTikTok(arg, dir)
      } else {
        const buf = await getVideoBuffer(msg)
        if (!buf) {
          return say('🔊 *FigSom*\nEnvie um vídeo com a legenda *!figsom*, responda um vídeo com *!figsom* ou mande *!figsom link-do-tiktok*.')
        }
        await fs.writeFile(videoPath, buf)
        await say('⏳ Criando sua figurinha...')
      }
      const built = await buildSticker(videoPath, dir)
      const r = await sendStickerResult(jid, built)
      if (r.mode === 'sticker-only') await say('Esse vídeo não tem som, mandei figurinha normal.')
      if (r.mode === 'sticker+audio') await say('⚠️ Esta versão do Baileys ainda não conhece figurinha com som. Mandei figurinha + áudio.')
      if (r.trimmed) await say(`✂️ Usei só os primeiros ${CFG.maxSeconds}s.`)
    })
  } catch (err) {
    console.error(err)
    await say('❌ Não consegui processar esse vídeo.')
  }
}

// ---------- conexão ----------
export async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: ['FigSom', 'Chrome', '1.0.0'],
  })
  wa.sock = sock
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      wa.qr = qr
      wa.state = 'qr'
    }
    if (connection === 'open') {
      wa.state = 'open'
      wa.qr = null
      wa.me = jidNormalizedUser(sock.user.id)
      console.log('✅ WhatsApp conectado:', wa.me)
      console.log(SUPPORTS_AUDIO_STICKER
        ? '🔊 Figurinha com som: suportada por esta versão do Baileys.'
        : '⚠️ Figurinha com som NÃO suportada nesta versão do Baileys (modo figurinha + áudio).')
    }
    if (connection === 'close') {
      wa.state = 'connecting'
      wa.me = null
      const code = lastDisconnect?.error?.output?.statusCode
      if (code === DisconnectReason.loggedOut) {
        await fs.rm(AUTH_DIR, { recursive: true, force: true }) // sessão inválida: gera QR novo
      }
      startWhatsApp()
    }
  })

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      enqueue(() => handleCommand(msg)).catch((e) => console.error('Erro:', e))
    }
  })
}

// Conectar com código (para quem está no próprio celular e não consegue ler o QR)
export async function requestPairing(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15) throw new Error('Número inválido (país + DDD, só números).')
  if (wa.state !== 'qr' || wa.sock?.authState?.creds?.registered) {
    throw new Error('Ainda conectando. Aguarde alguns segundos e tente de novo.')
  }
  return wa.sock.requestPairingCode(digits)
}

export async function logout() {
  try {
    await wa.sock?.logout()
  } catch (e) {
    console.error('logout:', e.message)
  }
}
