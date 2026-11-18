// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useUiModeStore } from '@/lib/fork-ui'
import type { AgentSettings as SavedAgent, AgentSettingsInput } from '@/lib/agents/settings'
import en from '../../../../../messages/en.json'
import zh from '../../../../../messages/zh.json'
import zhTW from '../../../../../messages/zh-TW.json'

const { list, create, update } = vi.hoisted(() => ({
  list: vi.fn<() => Promise<SavedAgent[]>>(),
  create: vi.fn<(input: AgentSettingsInput) => Promise<string>>(),
  update: vi.fn<(id: string, input: AgentSettingsInput) => Promise<void>>(),
}))
vi.mock('@/db/agents', () => ({
  listAgentSettings: list, createAgentSettings: create, updateAgentSettings: update,
}))

vi.mock('next-intl', async importOriginal => {
  const intl = await importOriginal<typeof import('next-intl')>()
  return {
    ...intl,
    useTranslations: () => intl.createTranslator({ locale: 'en', messages: { agents: en.agents }, namespace: 'agents' }),
  }
})

import { AgentSettings } from './agent-settings'

it('keeps the complete agent settings namespace in all three locales', () => {
  const keys = (value: typeof en.agents) => Object.entries(value).flatMap(([key, label]) =>
    typeof label === 'string' ? [key] : Object.keys(label).map(child => `${key}.${child}`),
  ).sort()
  expect(keys(zh.agents)).toEqual(keys(en.agents))
  expect(keys(zhTW.agents)).toEqual(keys(en.agents))
})

it('shows settings only in V3 and can create, edit and disable an agent', async () => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  useUiModeStore.setState({ mode: 'classic' })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let saved: SavedAgent[] = []
  list.mockImplementation(async () => saved)
  create.mockImplementation(async values => {
    saved = [{ ...values, id: 'a', createdAt: 1, updatedAt: 1 }]
    return 'a'
  })
  update.mockImplementation(async (_id, values) => {
    saved = [{ ...saved[0], ...values, updatedAt: 2 }]
  })

  const button = (name: string) => [...container.querySelectorAll('button')].find(btn => btn.textContent?.startsWith(name))!
  const changeName = async (value: string) => {
    const input = container.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  try {
    await act(async () => root.render(React.createElement(AgentSettings)))
    expect(container.textContent).toBe('')
    expect(list).not.toHaveBeenCalled()

    await act(async () => useUiModeStore.setState({ mode: 'v3' }))
    expect(container.textContent).toContain(en.agents.empty)
    await act(async () => button(en.agents.add).click())
    await changeName('My organizer')
    const role = container.querySelector('select')!
    await act(async () => {
      role.value = 'organizer'
      role.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => button(en.agents.save).click())
    expect(create).toHaveBeenCalledWith({
      name: 'My organizer', role: 'organizer', enabled: true,
      allowedTools: ['note_list_files', 'note_read_file', 'note_create_file'],
    })
    expect(container.textContent).toContain('My organizer')

    await act(async () => button(en.agents.edit).click())
    await changeName('Renamed organizer')
    const enabled = [...container.querySelectorAll('label')].find(label => label.textContent === en.agents.enabled)!
    await act(async () => enabled.querySelector('input')!.click())
    await act(async () => button(en.agents.save).click())
    expect(update).toHaveBeenCalledWith('a', expect.objectContaining({ name: 'Renamed organizer', enabled: false }))
    expect(container.textContent).toContain(en.agents.disabled)

    await act(async () => useUiModeStore.setState({ mode: 'classic' }))
    expect(container.textContent).toBe('')
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
