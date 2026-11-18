// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import { dailyNotePath } from '@/lib/daily/format'
import { hideWhen, linkExclusiveOverlays } from '@/lib/fork-overlays/exclusive'
import { useUiModeStore } from '@/lib/fork-ui'
import { loadCalendarWeek, requestCalendarWeekAccess } from '@/lib/week/calendar'
import { useWeekOverlay } from '@/lib/week/overlay'
import { indexNote } from '@/lib/vault-index/index-note'
import useDailySettingsStore from '@/stores/daily-settings'
import useVaultIndexStore from '@/stores/vault-index'
import messages from '../../../../../messages/en.json'
import { WeekScreen } from './week-screen'

vi.mock('@/lib/week/calendar', () => ({ loadCalendarWeek: vi.fn(), requestCalendarWeekAccess: vi.fn() }))
vi.mock('@/lib/decide/actions', () => ({ refreshJournal: async () => undefined }))
vi.mock('@/lib/decide/use-decisions', () => ({ useDecisions: () => [] }))

let root: Root
let host: HTMLElement
const at = (day: number, hour: number) => new Date(2026, 10, day, hour)

beforeEach(async () => {
  vi.setSystemTime(at(18, 9))
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.mocked(loadCalendarWeek).mockReset()
  vi.mocked(requestCalendarWeekAccess).mockReset()
  useUiModeStore.setState({ mode: 'v3' })
  useWeekOverlay.getState().hide()
  useDailySettingsStore.setState({ initialized: true })
  useVaultIndexStore.getState().replaceAll(new Map())
  useVaultIndexStore.getState().upsert([indexNote(dailyNotePath(at(18, 0)), '- [ ] Draft budget ⏰ 14:00', 1)])
  useVaultIndexStore.getState().setStatus('ready')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const intl = { locale: 'en', messages, timeZone: 'Asia/Taipei' as const, children: React.createElement(WeekScreen) }
  await act(async () => root.render(React.createElement(NextIntlClientProvider, intl)))
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('week screen', () => {
  it('shows tasks while access is off, requests it explicitly, and navigates to the next week', async () => {
    vi.mocked(loadCalendarWeek).mockResolvedValueOnce({ access: 'notDetermined', events: [] })
    const granted = {
      access: 'granted' as const,
      events: [{ id: 'meet', title: 'Product review', start: at(18, 10).getTime(), end: at(18, 11).getTime(), calendar: 'Work', allDay: false }],
    }
    vi.mocked(requestCalendarWeekAccess).mockResolvedValue(granted)
    vi.mocked(loadCalendarWeek).mockResolvedValueOnce(granted).mockResolvedValue({ access: 'granted', events: [] })

    await act(async () => useWeekOverlay.getState().show())
    expect(loadCalendarWeek).toHaveBeenLastCalledWith(at(16, 0))
    expect(host.querySelectorAll('time')).toHaveLength(7)
    expect(host.textContent).toContain('Draft budget')
    expect(host.textContent).toContain('Allow access to show calendar events.')
    const grant = Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Allow calendar access')
    expect(grant).toBeDefined()
    await act(async () => grant?.click())
    expect(requestCalendarWeekAccess).toHaveBeenCalledWith(at(16, 0))
    expect(host.textContent).toContain('Product review')

    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Next week"]')?.click())
    expect(loadCalendarWeek).toHaveBeenLastCalledWith(at(23, 0))
    expect(host.textContent).not.toContain('Product review')
    expect(host.textContent).not.toContain('Draft budget')
  })

  it('closes when another overlay opens or the mode switches to classic', async () => {
    const other = create<{ visible: boolean, hide: () => void }>(set => ({ visible: false, hide: () => set({ visible: false }) }))
    const unlink = linkExclusiveOverlays([other, useWeekOverlay])
    const unsub = useUiModeStore.subscribe(state => hideWhen(() => state.mode !== 'v3', [useWeekOverlay]))
    vi.mocked(loadCalendarWeek).mockResolvedValue({ access: 'denied', events: [] })
    try {
      await act(async () => useWeekOverlay.getState().show())
      expect(host.textContent).toContain('Week plan')
      await act(async () => other.setState({ visible: true }))
      expect(host.textContent).toBe('')
      await act(async () => useWeekOverlay.getState().show())
      expect(other.getState().visible).toBe(false)
      await act(async () => useUiModeStore.setState({ mode: 'classic' }))
      await act(async () => useWeekOverlay.getState().show())
      expect(host.textContent).toBe('')
      expect(useWeekOverlay.getState().visible).toBe(false)
    } finally {
      unlink()
      unsub()
    }
  })
})
