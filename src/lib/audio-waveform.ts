const WAVEFORM_BIN_COUNT = 72
const MAX_FRAMES_PER_BIN = 256
const MAX_RIFF_CHUNKS = 4096
const MAX_CHANNELS = 8
const MAX_DECODE_BYTES = 16 * 1024 * 1024
const MAX_DECODE_DURATION_SECONDS = 5 * 60
const WAVEFORM_SAMPLE_RATE = 12_000

function buildWaveform(frameCount: number, getFramePeak: (frame: number) => number): number[] {
  let overallPeak = 0
  const peaks = Array.from({ length: WAVEFORM_BIN_COUNT }, (_, bin) => {
    const start = Math.floor(bin * frameCount / WAVEFORM_BIN_COUNT)
    const end = Math.floor((bin + 1) * frameCount / WAVEFORM_BIN_COUNT)
    const span = Math.max(1, end - start)
    const samples = Math.min(span, MAX_FRAMES_PER_BIN)
    let peak = 0

    for (let sample = 0; sample < samples; sample++) {
      const frame = start + Math.floor((sample + 0.5) * span / samples)
      peak = Math.max(peak, getFramePeak(frame))
    }

    overallPeak = Math.max(overallPeak, peak)
    return peak
  })

  return overallPeak > 0 ? peaks.map((peak) => peak / overallPeak) : peaks
}

function readFourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}

export function getPcmWaveform(bytes: Uint8Array): number[] | null {
  if (bytes.byteLength < 12) return null

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (readFourCC(view, 0) !== 'RIFF' || readFourCC(view, 8) !== 'WAVE') return null

  const limit = view.getUint32(4, true) + 8
  if (limit < 12 || limit > view.byteLength) return null

  let formatOffset: number | undefined
  let data: { offset: number; size: number } | undefined
  let offset = 12

  for (let chunk = 0; chunk < MAX_RIFF_CHUNKS && offset + 8 <= limit; chunk++) {
    const id = readFourCC(view, offset)
    const size = view.getUint32(offset + 4, true)
    const start = offset + 8
    const next = start + size + (size % 2)
    if (next > limit) return null

    if (id === 'fmt ' && formatOffset === undefined) {
      if (size < 16) return null
      formatOffset = start
    } else if (id === 'data' && data === undefined) {
      data = { offset: start, size }
    }

    if (formatOffset !== undefined && data !== undefined) break
    offset = next
  }

  if (formatOffset === undefined || data === undefined) return null

  const format = view.getUint16(formatOffset, true)
  const channels = view.getUint16(formatOffset + 2, true)
  const sampleRate = view.getUint32(formatOffset + 4, true)
  const blockAlign = view.getUint16(formatOffset + 12, true)
  const bitsPerSample = view.getUint16(formatOffset + 14, true)

  if (format !== 1 || bitsPerSample !== 16 || sampleRate === 0) return null
  if (channels < 1 || channels > MAX_CHANNELS || blockAlign !== channels * 2) return null
  if (data.size < blockAlign || data.size % blockAlign !== 0) return null

  const dataOffset = data.offset
  return buildWaveform(data.size / blockAlign, (frame) => {
    const start = dataOffset + frame * blockAlign
    let peak = 0

    for (let channel = 0; channel < channels; channel++) {
      peak = Math.max(peak, Math.abs(view.getInt16(start + channel * 2, true)))
    }

    return peak
  })
}

export async function decodeAudioWaveform(blob: Blob, duration: number): Promise<number[] | null> {
  if (
    typeof OfflineAudioContext === 'undefined' ||
    blob.size === 0 || blob.size > MAX_DECODE_BYTES ||
    !Number.isFinite(duration) || duration <= 0 || duration > MAX_DECODE_DURATION_SECONDS
  ) return null

  try {
    // The decoder resamples to the context rate without starting audio output.
    const context = new OfflineAudioContext(1, 1, WAVEFORM_SAMPLE_RATE)
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    if (
      decoded.length === 0 || decoded.duration > MAX_DECODE_DURATION_SECONDS ||
      decoded.numberOfChannels < 1 || decoded.numberOfChannels > MAX_CHANNELS
    ) return null

    const channels = Array.from({ length: decoded.numberOfChannels }, (_, channel) => (
      decoded.getChannelData(channel)
    ))

    return buildWaveform(decoded.length, (frame) => {
      let peak = 0

      for (const channel of channels) {
        const sample = channel[frame]
        if (Number.isFinite(sample)) peak = Math.max(peak, Math.abs(sample))
      }

      return peak
    })
  } catch {
    return null
  }
}
