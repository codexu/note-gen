'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BaseDirectory, readFile } from '@tauri-apps/plugin-fs'
import { ChevronDown, Pause, Play, RotateCcw, RotateCw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Slider } from '@/components/ui/slider'
import { Spinner } from '@/components/ui/spinner'
import { decodeAudioWaveform, getPcmWaveform } from '@/lib/audio-waveform'
import emitter from '@/lib/emitter'
import { cn } from '@/lib/utils'

const AUDIO_MIME_TYPES: Record<string, string> = {
  aac: 'audio/aac',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  mp4: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  webm: 'audio/webm',
  wma: 'audio/x-ms-wma',
}
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const SKIP_SECONDS = 15

interface AudioPlayerProps {
  audioPath: string
  variant?: 'compact' | 'inline' | 'detail'
  className?: string
}

function formatTime(time: number, fractionalDigits = 0) {
  const elapsed = Number.isFinite(time) && time > 0 ? time : 0
  if (fractionalDigits > 0) return `0:${elapsed.toFixed(fractionalDigits).padStart(3 + fractionalDigits, '0')}`

  const seconds = Math.floor(elapsed)
  const minutes = Math.floor(seconds / 60)
  const remainder = String(seconds % 60).padStart(2, '0')
  if (minutes < 60) return `${minutes}:${remainder}`
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${remainder}`
}

function PlaybackWaveform({ peaks, progress }: { peaks: number[]; progress: number }) {
  const played = Math.floor(progress * peaks.length)
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-1/2 grid h-6 -translate-y-1/2 items-center [.mobile-keyboard-open_&]:h-5"
      style={{ gridTemplateColumns: `repeat(${peaks.length}, minmax(0, 1fr))` }}
    >
      {peaks.map((peak, index) => (
        <span
          key={index}
          data-played={index < played ? '' : undefined}
          className="mx-auto w-[68%] max-w-1 rounded-full bg-muted-foreground/30 data-[played]:bg-primary"
          style={{ height: `${Math.max(8, Math.sqrt(peak) * 100)}%` }}
        />
      ))}
    </div>
  )
}

export function AudioPlayer(props: AudioPlayerProps) {
  return <AudioPlayback key={props.audioPath} {...props} />
}

function AudioPlayback({ audioPath, variant = 'inline', className }: AudioPlayerProps) {
  const t = useTranslations('recording.playback')
  const audioRef = useRef<HTMLAudioElement>(null)
  const [source, setSource] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState<number | null>(null)
  const [rate, setRate] = useState(1)
  const [waveform, setWaveform] = useState<{ source: string; peaks: number[] } | null>(null)
  const waveformToDecode = useRef<{ source: string; blob: Blob } | null>(null)
  const detail = variant === 'detail'
  const compact = variant === 'compact'

  const retry = useCallback(() => {
    setStatus('loading')
    setPlaying(false)
    setSource(null)
    setPosition(0)
    setDuration(null)
    setWaveform(null)
    waveformToDecode.current = null
    setAttempt(current => current + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | undefined
    const path = audioPath.replace(/^[/\\]+/, '').replace(/\\/g, '/')

    const onAssetsDownloaded = ({ paths }: { paths: string[] }) => {
      if (!objectUrl && paths.includes(path)) retry()
    }
    emitter.on('record-assets-downloaded', onAssetsDownloaded)

    async function loadFile() {
      try {
        const bytes = await readFile(path, { baseDir: BaseDirectory.AppData })
        if (cancelled) return
        if (!bytes.byteLength) {
          setStatus('error')
          return
        }
        const extension = path.split('.').pop()?.toLowerCase() ?? ''
        const audioBytes = new Uint8Array(bytes)
        const blob = new Blob([audioBytes], { type: AUDIO_MIME_TYPES[extension] ?? '' })
        objectUrl = URL.createObjectURL(blob)
        if (detail) {
          const peaks = getPcmWaveform(audioBytes)
          if (peaks) setWaveform({ source: objectUrl, peaks })
          else waveformToDecode.current = { source: objectUrl, blob }
        }
        setSource(objectUrl)
      } catch (error) {
        if (cancelled) return
        console.error('Failed to load recording:', error)
        setStatus('error')
      }
    }

    void loadFile()
    return () => {
      cancelled = true
      emitter.off('record-assets-downloaded', onAssetsDownloaded)
      if (waveformToDecode.current?.source === objectUrl) waveformToDecode.current = null
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [audioPath, attempt, detail, retry])

  async function togglePlayback() {
    const audio = audioRef.current
    if (!audio || status !== 'ready') return
    if (!audio.paused) {
      audio.pause()
      return
    }
    try {
      await audio.play()
    } catch (error) {
      if (audioRef.current !== audio || (error instanceof DOMException && error.name === 'AbortError')) return
      console.error('Failed to play recording:', error)
      setPlaying(false)
      setStatus('error')
    }
  }

  function seek(time: number) {
    const audio = audioRef.current
    if (!audio || status !== 'ready' || duration === null || !Number.isFinite(time)) return
    audio.currentTime = Math.min(Math.max(time, 0), duration)
    setPosition(audio.currentTime)
  }

  function skip(seconds: number) {
    const audio = audioRef.current
    if (audio) seek(audio.currentTime + seconds)
  }

  function changeRate(value: string) {
    const nextRate = Number(value)
    const audio = audioRef.current
    if (!audio || !PLAYBACK_RATES.includes(nextRate)) return
    audio.defaultPlaybackRate = nextRate
    audio.playbackRate = nextRate
    setRate(nextRate)
  }

  function updateDuration(audio: HTMLAudioElement) {
    const knownDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null
    setDuration(knownDuration)
    const pending = waveformToDecode.current
    if (knownDuration === null || !pending || pending.source !== audio.src) return
    waveformToDecode.current = null
    void decodeAudioWaveform(pending.blob, knownDuration).then(peaks => {
      if (peaks && audioRef.current === audio) setWaveform({ source: pending.source, peaks })
    })
  }

  const playLabel = t(playing ? 'pause' : 'play')
  const statusText = status === 'loading' ? t('loading') : status === 'error' ? t('unavailable') : ''
  const buttonLabel = status === 'error' ? t('retry') : statusText || playLabel
  const fractionalDigits = duration !== null && duration < 1 ? (duration < 0.1 ? 2 : 1) : 0
  const elapsed = formatTime(duration === null ? position : Math.min(position, duration), fractionalDigits)
  const total = duration === null ? '—' : formatTime(duration, fractionalDigits)
  const peaks = waveform && waveform.source === source && duration !== null ? waveform.peaks : null
  const canSeek = status === 'ready' && duration !== null
  const timeClassName = 'shrink-0 whitespace-nowrap text-xs text-muted-foreground tabular-nums'
  const button = (
    <Button
      type="button"
      variant={detail ? status === 'ready' ? 'default' : 'secondary' : 'ghost'}
      size={compact ? 'icon-xs' : detail ? 'icon' : 'icon-sm'}
      className={cn(detail && 'size-9 pointer-coarse:size-11', compact && 'size-5')}
      disabled={status === 'loading'}
      aria-label={buttonLabel}
      title={status === 'error' && compact ? `${statusText} · ${buttonLabel}` : buttonLabel}
      onClick={status === 'error' ? retry : () => void togglePlayback()}
    >
      {status === 'loading' ? <Spinner aria-hidden="true" className="motion-reduce:animate-none" />
        : status === 'error' ? <RotateCw aria-hidden="true" />
        : playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
    </Button>
  )

  const timeline = !compact && (detail || status === 'ready') ? (
    <div
      dir={detail && status === 'ready' ? 'ltr' : undefined}
      className="flex min-w-0 flex-1 items-center gap-2"
    >
      {detail ? (
        <span role="status" className={statusText ? 'min-w-0 truncate text-xs text-muted-foreground' : 'sr-only'}>{statusText}</span>
      ) : null}
      {status === 'ready' ? (
        <>
          <div className="relative min-w-0 flex-1">
            {detail && peaks && duration !== null ? <PlaybackWaveform peaks={peaks} progress={position / duration} /> : null}
            <Slider
              value={[duration === null ? 0 : Math.min(position, duration)]}
              max={duration ?? 1}
              step={fractionalDigits > 0 ? 0.01 : 0.1}
              disabled={!canSeek}
              onValueChange={([time]) => seek(time)}
              thumbProps={{ 'aria-label': t('progress'), 'aria-valuetext': t('elapsed', { time: elapsed }) }}
              data-swipe-back-ignore
              className={cn(
                'cursor-pointer data-[disabled]:cursor-default',
                detail ? 'h-9 pointer-coarse:h-11 [&>[data-slot=slider-track]]:h-1.5 [&>[data-slot=slider-track]]:bg-border' : 'h-5',
                detail && peaks && '[&>[data-slot=slider-track]]:opacity-0 [&_[data-slot=slider-thumb]]:h-7 [&_[data-slot=slider-thumb]]:w-0.5 [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:bg-primary [.mobile-keyboard-open_&]:[&_[data-slot=slider-thumb]]:h-6',
              )}
            />
          </div>
          <span dir="ltr" className={timeClassName}>
            <span className="text-foreground">{elapsed}</span>{' / '}{total}
          </span>
        </>
      ) : null}
    </div>
  ) : null

  const backLabel = t('skipBackward', { seconds: SKIP_SECONDS })
  const forwardLabel = t('skipForward', { seconds: SKIP_SECONDS })
  const optionsLabel = t('options', { rate })

  return (
    <div
      role="group"
      aria-label={t('label')}
      className={cn(
        'flex min-w-0 items-center',
        compact ? 'shrink-0' : 'w-full gap-2',
        detail && 'py-1',
        !detail && !compact && 'rounded-lg bg-muted/30 px-2 py-0.5',
        className,
      )}
    >
      {source ? (
        <audio
          key={source}
          ref={audioRef}
          src={source}
          hidden
          preload="metadata"
          onLoadedMetadata={(event) => {
            const audio = event.currentTarget
            audio.defaultPlaybackRate = rate
            audio.playbackRate = rate
            updateDuration(audio)
            setStatus('ready')
          }}
          onDurationChange={(event) => updateDuration(event.currentTarget)}
          onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() => {
            setPlaying(false)
            setStatus('error')
          }}
        />
      ) : null}
      {button}
      {!detail ? (
        <span role="status" className={compact || !statusText ? 'sr-only' : 'min-w-0 text-xs text-muted-foreground'}>{statusText}</span>
      ) : null}
      {timeline}
      {detail ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 px-2 tabular-nums pointer-coarse:h-11 [.mobile-keyboard-open_&]:hidden"
              disabled={status !== 'ready'}
              aria-label={optionsLabel}
              title={optionsLabel}
            >
              {rate}×<ChevronDown aria-hidden="true" data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => skip(-SKIP_SECONDS)} disabled={!canSeek} className="pointer-coarse:min-h-11">
                <RotateCcw aria-hidden="true" />
                {backLabel}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => skip(SKIP_SECONDS)} disabled={!canSeek} className="pointer-coarse:min-h-11">
                <RotateCw aria-hidden="true" />
                {forwardLabel}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={String(rate)} onValueChange={changeRate} aria-label={t('currentSpeed', { rate })}>
              {PLAYBACK_RATES.map(option => (
                <DropdownMenuRadioItem key={option} value={String(option)} className="pointer-coarse:min-h-11">
                  {option}×
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}
