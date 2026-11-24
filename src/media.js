// Conversão de mídia: vídeo -> figurinha WebP animada + áudio (ffmpeg) e download do TikTok (yt-dlp)
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const run = promisify(execFile)

export const CFG = {
  maxSeconds: 10, // limite do WhatsApp para figurinha com som
  maxStickerKB: 500, // tamanho alvo do WebP animado
  maxDownloadMB: 50, // limite de download do TikTok
  audioFormat: process.env.AUDIO_FORMAT === 'm4a' ? 'm4a' : 'ogg',
}
export const AUDIO_MIME = CFG.audioFormat === 'm4a' ? 'audio/mp4' : 'audio/ogg; codecs=opus'
export const TIKTOK_RE = /^https?:\/\/((www|m|vm|vt)\.)?tiktok\.com\/\S+$/i

// Fila: um vídeo por vez, para não derrubar o servidor
let chain = Promise.resolve()
export function enqueue(job) {
  const p = chain.then(job)
  chain = p.catch(() => {})
  return p
}

export async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'figsom-'))
  try {
    return await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

async function probe(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type',
    '-of', 'json',
    file,
  ])
  const info = JSON.parse(stdout)
  return {
    duration: parseFloat(info.format?.duration ?? '0'),
    hasAudio: (info.streams ?? []).some((s) => s.codec_type === 'audio'),
  }
}

async function toWebp(input, output, seconds) {
  const attempts = [
    { fps: 15, q: 45 },
    { fps: 12, q: 35 },
    { fps: 10, q: 25 },
    { fps: 8, q: 15 },
  ]
  let result
  for (const a of attempts) {
    await run('ffmpeg', [
      '-y', '-i', input, '-t', String(seconds), '-an',
      '-vf',
      `fps=${a.fps},scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0`,
      '-c:v', 'libwebp', '-loop', '0',
      '-q:v', String(a.q), '-compression_level', '6',
      output,
    ])
    result = await fs.readFile(output)
    if (result.length <= CFG.maxStickerKB * 1024) break
  }
  return result
}

async function toAudio(input, output, seconds) {
  const codec =
    CFG.audioFormat === 'm4a'
      ? ['-c:a', 'aac', '-b:a', '64k']
      : ['-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1']
  await run('ffmpeg', ['-y', '-i', input, '-t', String(seconds), '-vn', ...codec, output])
  return fs.readFile(output)
}

export async function downloadTikTok(url, dir) {
  await run(
    'yt-dlp',
    [
      '--no-playlist',
      '--max-filesize', `${CFG.maxDownloadMB}M`,
      '-f', 'mp4/best',
      '--merge-output-format', 'mp4',
      '-o', path.join(dir, 'tiktok.%(ext)s'),
      '--', url,
    ],
    { timeout: 90_000 },
  )
  const file = (await fs.readdir(dir)).find((n) => n.startsWith('tiktok.'))
  if (!file) throw new Error('yt-dlp não gerou arquivo')
  return path.join(dir, file)
}

// Vídeo -> { webp, audio|null, seconds, hasAudio, trimmed }
export async function buildSticker(videoPath, dir) {
  const { duration, hasAudio } = await probe(videoPath)
  const seconds = Math.max(1, Math.min(duration || CFG.maxSeconds, CFG.maxSeconds))
  const webp = await toWebp(videoPath, path.join(dir, 'out.webp'), seconds)
  const audio = hasAudio
    ? await toAudio(videoPath, path.join(dir, `out.${CFG.audioFormat}`), seconds)
    : null
  return { webp, audio, seconds, hasAudio, trimmed: duration > CFG.maxSeconds }
}
