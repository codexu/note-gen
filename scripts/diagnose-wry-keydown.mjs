#!/usr/bin/env node

import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const cargoLockPath = join(process.cwd(), 'src-tauri', 'Cargo.lock')
const wryParentRelativePath = join('src', 'wkwebview', 'class', 'wry_web_view_parent.rs')

export function readCargoLockPackageVersion(lockText, packageName) {
  const packageBlocks = lockText.split(/\n(?=\[\[package\]\]\n)/)
  for (const block of packageBlocks) {
    if (new RegExp(`^name = "${packageName}"$`, 'm').test(block)) {
      const versionMatch = block.match(/^version = "([^"]+)"$/m)
      if (versionMatch) return versionMatch[1]
    }
  }
  return null
}

export function findRegistryPackageSource(packageName, version) {
  const registrySrcRoot = join(homedir(), '.cargo', 'registry', 'src')
  if (!existsSync(registrySrcRoot)) return null

  for (const registryDir of readdirSync(registrySrcRoot)) {
    const packagePath = join(registrySrcRoot, registryDir, `${packageName}-${version}`)
    const sourcePath = join(packagePath, wryParentRelativePath)
    if (existsSync(sourcePath)) return sourcePath
  }

  return null
}

export function extractKeyDownMethod(sourceText) {
  const methodStart = sourceText.indexOf('fn key_down(&self, event: &NSEvent)')
  if (methodStart === -1) return ''

  const drawStart = sourceText.indexOf('#[cfg(target_os = "macos")]', methodStart + 1)
  return sourceText.slice(methodStart, drawStart === -1 ? undefined : drawStart)
}

export function analyzeKeyDownSource(sourceText) {
  const keyDownMethod = extractKeyDownMethod(sourceText)

  return {
    hasKeyDownOverride: keyDownMethod.length > 0,
    callsPerformKeyEquivalent: keyDownMethod.includes('performKeyEquivalent(event)'),
    checksPerformKeyEquivalentReturnValue: keyDownMethod.includes('if menu.performKeyEquivalent(event)'),
    hasCommandOrControlGuard:
      keyDownMethod.includes('NSEventModifierFlags::Command') ||
      keyDownMethod.includes('NSEventModifierFlags::Control'),
    mentionsOptionExclusion: /Option|Alt/.test(keyDownMethod),
    callsInterpretKeyEvents: keyDownMethod.includes('interpretKeyEvents'),
  }
}

export function patchWryKeyDownSource(sourceText) {
  let patched = sourceText
    .replace(
      'use objc2_app_kit::{NSApplication, NSEvent, NSView, NSWindow, NSWindowButton};',
      [
        'use objc2_app_kit::{',
        '  NSApplication, NSEvent, NSEventModifierFlags, NSView, NSWindow, NSWindowButton,',
        '};',
      ].join('\n'),
    )
    .replace(
      'use objc2_foundation::NSRect;',
      'use objc2_foundation::{NSArray, NSRect};',
    )

  const keyDownMethod = extractKeyDownMethod(patched)
  assert.ok(keyDownMethod, 'Wry key_down method not found')

  const guardedKeyDownMethod = `fn key_down(&self, event: &NSEvent) {
      let flags = unsafe { event.modifierFlags() };

      // Only attempt menu key equivalents when Command or Control modifiers
      // are held. Option (Alt) is intentionally excluded because Option+key
      // combinations are used for special/dead-key input.
      if flags.intersects(NSEventModifierFlags::Command | NSEventModifierFlags::Control) {
        let mtm = MainThreadMarker::new().unwrap();
        let app = NSApplication::sharedApplication(mtm);
        unsafe {
          if let Some(menu) = app.mainMenu() {
            if menu.performKeyEquivalent(event) {
              return;
            }
          }
        }
      }

      unsafe {
        self.interpretKeyEvents(&NSArray::from_slice(&[event]));
      }
    }

    `

  return patched.replace(keyDownMethod, guardedKeyDownMethod)
}

export function preparePatchedWrySource({ sourceRoot, outputRoot }) {
  assert.ok(sourceRoot, 'sourceRoot is required')
  assert.ok(outputRoot, 'outputRoot is required')
  const sourceFile = join(sourceRoot, wryParentRelativePath)
  const outputFile = join(outputRoot, wryParentRelativePath)

  assert.ok(existsSync(sourceFile), `Wry keyDown source not found: ${sourceFile}`)

  rmSync(outputRoot, { recursive: true, force: true })
  mkdirSync(outputRoot, { recursive: true })
  cpSync(sourceRoot, outputRoot, { recursive: true })

  const patchedSource = patchWryKeyDownSource(readFileSync(outputFile, 'utf8'))
  writeFileSync(outputFile, patchedSource)

  return {
    sourceRoot,
    outputRoot,
    sourceFile,
    outputFile,
    macosKeyDown: analyzeKeyDownSource(patchedSource),
  }
}

export function diagnoseCurrentWryKeyDown() {
  assert.ok(existsSync(cargoLockPath), `Cargo.lock not found: ${cargoLockPath}`)

  const lockText = readFileSync(cargoLockPath, 'utf8')
  const versions = {
    tauri: readCargoLockPackageVersion(lockText, 'tauri'),
    tao: readCargoLockPackageVersion(lockText, 'tao'),
    wry: readCargoLockPackageVersion(lockText, 'wry'),
  }

  assert.ok(versions.wry, 'wry package version not found in Cargo.lock')

  const wrySourcePath = findRegistryPackageSource('wry', versions.wry)
  assert.ok(
    wrySourcePath,
    `wry ${versions.wry} source not found under ~/.cargo/registry/src; run cargo check first`,
  )

  const sourceText = readFileSync(wrySourcePath, 'utf8')

  return {
    versions,
    wrySourcePath,
    macosKeyDown: analyzeKeyDownSource(sourceText),
    assessment: 'current_wry_macos_keydown_routes_to_menu_without_forwarding_guard',
    upstreamCandidate: 'https://github.com/tauri-apps/wry/pull/1711',
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const diagnostics = diagnoseCurrentWryKeyDown()
  if (process.argv.includes('--prepare-patch')) {
    const packageRoot = diagnostics.wrySourcePath.slice(
      0,
      diagnostics.wrySourcePath.length - wryParentRelativePath.length - 1,
    )
    const outputArgIndex = process.argv.indexOf('--output')
    const outputRoot = outputArgIndex === -1
      ? join(tmpdir(), `notegen-wry-${diagnostics.versions.wry}-keydown-patched`)
      : process.argv[outputArgIndex + 1]
    console.log(JSON.stringify({
      ...diagnostics,
      preparedPatch: preparePatchedWrySource({
        sourceRoot: packageRoot,
        outputRoot,
      }),
    }, null, 2))
  } else {
    console.log(JSON.stringify(diagnostics, null, 2))
  }
}
