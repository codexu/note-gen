// almanac P0-a：v5 token 數值與 accent 對比度的防回退測試。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.resolve(__dirname, 'fork-theme.css'), 'utf8')
const tokensCss = readFileSync(path.resolve(__dirname, 'fork-tokens.css'), 'utf8')

function block(selector: ':root' | '.dark'): string {
  const start = css.search(new RegExp(`^${selector.replace('.', '\\.')} \\{`, 'm'))
  expect(start).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('\n}', start))
}

function token(selector: ':root' | '.dark', name: string): string {
  const match = block(selector).match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm'))
  if (!match) throw new Error(`missing --${name} in ${selector}`)
  return match[1].trim()
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// 簡報 §3.1（almanac/2026-11-18_handoff_ornata-style-brief.md）；muted → muted-ink、accent → brand-accent、success → success-ink
const BRIEF = {
  ':root': {
    bg: '#fcfcfd', panel: '#f9f9fa', sunken: '#e9e9e6', statusbar: '#f7f7f8', menu: '#f7f7f8',
    ink: '#191919', 'note-ink': '#191919', 'muted-ink': '#6e6e6a', faint: '#a3a39e',
    line: '#e3e3e0', 'line-soft': '#ececea',
    hover: 'rgba(25, 25, 25, 0.05)', active: 'rgba(25, 25, 25, 0.09)',
    invert: '#1c1c1c', 'invert-ink': '#fbfbfa',
    danger: '#b3261e', 'success-ink': '#4d8660',
    'brand-accent': '#167a6e', 'brand-accent-ink': '#ffffff',
  },
  '.dark': {
    bg: '#121417', panel: '#17191d', sunken: '#0d0f11', statusbar: '#1a1c20', menu: '#121417',
    ink: '#ebebe8', 'note-ink': '#cbd0d2', 'muted-ink': '#8f8f8a', faint: '#64645f',
    line: '#292927', 'line-soft': '#202020',
    hover: 'rgba(235, 235, 232, 0.06)', active: 'rgba(235, 235, 232, 0.1)',
    invert: '#ebebe8', 'invert-ink': '#131313',
    danger: '#e5484d', 'success-ink': '#72b588',
    'brand-accent': '#4cc3b0', 'brand-accent-ink': '#131313',
  },
} as const

describe('fork-theme v5 tokens', () => {
  for (const selector of [':root', '.dark'] as const) {
    it(`${selector} matches brief §3.1`, () => {
      for (const [name, value] of Object.entries(BRIEF[selector])) {
        expect(token(selector, name), `--${name}`).toBe(value)
      }
    })

    it(`${selector} accent and ink keep >= 4.5:1 on --bg`, () => {
      const bg = token(selector, 'bg')
      expect(contrast(token(selector, 'brand-accent'), bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(token(selector, 'ink'), bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(token(selector, 'muted-ink'), bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(token(selector, 'invert-ink'), token(selector, 'invert'))).toBeGreaterThanOrEqual(4.5)
    })

    it(`${selector} shadcn primary is the monochrome invert, not a hue`, () => {
      // HSL 三元組的飽和度要很低（反白），彩色只能走 --brand-accent
      const saturation = Number(token(selector, 'primary').split(/\s+/)[1].replace('%', ''))
      expect(saturation).toBeLessThan(10)
      expect(token(selector, 'ring')).toBe(token(selector, 'foreground'))
    })
  }

  it('maps v5 tokens into Tailwind and neutralises named hues', () => {
    for (const name of ['bg', 'panel', 'ink', 'faint', 'line', 'brand']) {
      expect(tokensCss).toMatch(new RegExp(`--color-${name}:`))
    }
    expect(tokensCss).toMatch(/--color-blue-500: oklch\(55\.3% 0\.013 58\.071\)/)
    expect(tokensCss).not.toMatch(/--color-red-/)
    expect(tokensCss).not.toMatch(/--color-green-/)
  })

  it('keeps the global focus ring overridable by Tailwind utilities', () => {
    expect(css).toMatch(/@layer base \{\s*:where\(button, a, input, textarea, select, \[tabindex\]\):focus-visible/)
  })

  it('respects prefers-reduced-motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })
})
