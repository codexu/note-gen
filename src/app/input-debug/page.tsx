'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type InputLog = {
  id: number
  time: string
  type: string
  target: string
  inputType?: string
  data?: string
  isComposing?: boolean
  value?: string
  controlledValue: string
}

const eventTypes = [
  'focus',
  'beforeinput',
  'input',
  'change',
  'compositionstart',
  'compositionupdate',
  'compositionend',
  'keydown',
  'keyup',
  'paste',
]

function describeTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return 'unknown'
  }

  const id = target.id ? `#${target.id}` : ''
  const name = target.getAttribute('name')
  const namePart = name ? `[name="${name}"]` : ''
  return `${target.tagName.toLowerCase()}${id}${namePart}`
}

function readTargetValue(target: EventTarget | null) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return target.value
  }

  if (target instanceof HTMLElement && target.isContentEditable) {
    return target.textContent ?? ''
  }

  return undefined
}

function readEventData(event: Event) {
  if (event instanceof InputEvent) {
    return {
      data: event.data ?? undefined,
      inputType: event.inputType || undefined,
      isComposing: event.isComposing,
    }
  }

  if (event instanceof CompositionEvent) {
    return {
      data: event.data || undefined,
    }
  }

  if (event instanceof KeyboardEvent) {
    return {
      data: event.key,
      isComposing: event.isComposing,
    }
  }

  return {}
}

export default function InputDebugPage() {
  const [controlledValue, setControlledValue] = useState('')
  const [logs, setLogs] = useState<InputLog[]>([])
  const nextIdRef = useRef(1)
  const controlledValueRef = useRef(controlledValue)

  useEffect(() => {
    controlledValueRef.current = controlledValue
  }, [controlledValue])

  const appendLog = useCallback((event: Event) => {
    const data = readEventData(event)
    const value = readTargetValue(event.target)
    const nextLog: InputLog = {
      id: nextIdRef.current,
      time: new Date().toISOString(),
      type: event.type,
      target: describeTarget(event.target),
      value,
      controlledValue: controlledValueRef.current,
      ...data,
    }
    nextIdRef.current += 1

    setLogs((current) => [nextLog, ...current].slice(0, 200))
  }, [])

  useEffect(() => {
    const handler = (event: Event) => appendLog(event)

    for (const type of eventTypes) {
      document.addEventListener(type, handler, true)
    }

    return () => {
      for (const type of eventTypes) {
        document.removeEventListener(type, handler, true)
      }
    }
  }, [appendLog])

  const clear = useCallback(() => {
    setControlledValue('')
    setLogs([])
    nextIdRef.current = 1
    const raw = document.getElementById('doubao-raw-textarea')
    if (raw instanceof HTMLTextAreaElement) {
      raw.value = ''
    }
    const plainInput = document.getElementById('doubao-plain-input')
    if (plainInput instanceof HTMLInputElement) {
      plainInput.value = ''
    }
    const editable = document.getElementById('doubao-contenteditable')
    if (editable instanceof HTMLElement) {
      editable.textContent = ''
    }
  }, [])

  const copyLogs = useCallback(async () => {
    await navigator.clipboard.writeText(JSON.stringify(logs.slice().reverse(), null, 2))
  }, [logs])

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
          <div>
            <h1 className="text-xl font-semibold">Input Event Debug</h1>
            <p className="text-sm text-muted-foreground">Tauri/WKWebView text receiver probe</p>
          </div>
          <div className="flex gap-2">
            <button className="rounded border px-3 py-2 text-sm" onClick={clear} type="button">
              Clear
            </button>
            <button className="rounded border px-3 py-2 text-sm" onClick={copyLogs} type="button">
              Copy logs
            </button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm font-medium">
            Raw textarea
            <textarea
              className="min-h-32 rounded border bg-transparent p-3 font-normal"
              id="doubao-raw-textarea"
              name="raw-textarea"
              placeholder="raw textarea"
              rows={6}
            />
          </label>

          <label className="flex flex-col gap-2 text-sm font-medium">
            React controlled textarea
            <textarea
              className="min-h-32 rounded border bg-transparent p-3 font-normal"
              id="doubao-controlled-textarea"
              name="controlled-textarea"
              onChange={(event) => setControlledValue(event.target.value)}
              placeholder="controlled textarea"
              rows={6}
              value={controlledValue}
            />
          </label>

          <label className="flex flex-col gap-2 text-sm font-medium">
            Plain input
            <input
              className="rounded border bg-transparent p-3 font-normal"
              id="doubao-plain-input"
              name="plain-input"
              placeholder="plain input"
            />
          </label>

          <div className="flex flex-col gap-2 text-sm font-medium">
            Content editable
            <div
              className="min-h-24 rounded border bg-transparent p-3 font-normal"
              contentEditable
              id="doubao-contenteditable"
              role="textbox"
              suppressContentEditableWarning
            />
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="text-base font-semibold">Event log</h2>
          <div className="max-h-[46vh] overflow-auto rounded border">
            <table className="w-full table-fixed text-left text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b">
                  <th className="w-20 p-2">#</th>
                  <th className="w-36 p-2">event</th>
                  <th className="w-48 p-2">target</th>
                  <th className="w-40 p-2">inputType/key</th>
                  <th className="p-2">value</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr className="border-b align-top" key={log.id}>
                    <td className="p-2 text-muted-foreground">{log.id}</td>
                    <td className="p-2">{log.type}</td>
                    <td className="p-2">{log.target}</td>
                    <td className="p-2">
                      {log.inputType || log.data || ''}
                      {log.isComposing ? ' composing' : ''}
                    </td>
                    <td className="break-words p-2">{log.value ?? log.controlledValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}
