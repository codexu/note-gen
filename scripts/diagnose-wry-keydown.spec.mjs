import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  analyzeKeyDownSource,
  patchWryKeyDownSource,
  preparePatchedWrySource,
} from './diagnose-wry-keydown.mjs'

const vulnerableSource = `
fn key_down(&self, event: &NSEvent) {
  let mtm = MainThreadMarker::new().unwrap();
  let app = NSApplication::sharedApplication(mtm);
  unsafe {
    if let Some(menu) = app.mainMenu() {
      menu.performKeyEquivalent(event);
    }
  }
}

#[cfg(target_os = "macos")]
fn draw(&self, _dirty_rect: NSRect) {}
`

const patchedSource = `
fn key_down(&self, event: &NSEvent) {
  let flags = unsafe { event.modifierFlags() };

  // Note: Option (Alt) is intentionally excluded.
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

#[cfg(target_os = "macos")]
fn draw(&self, _dirty_rect: NSRect) {}
`

test('detects vulnerable Wry macOS keyDown menu sink', () => {
  const result = analyzeKeyDownSource(vulnerableSource)

  assert.equal(result.callsPerformKeyEquivalent, true)
  assert.equal(result.checksPerformKeyEquivalentReturnValue, false)
  assert.equal(result.hasCommandOrControlGuard, false)
  assert.equal(result.mentionsOptionExclusion, false)
  assert.equal(result.callsInterpretKeyEvents, false)
})

test('detects patched Wry macOS keyDown forwarding guard shape', () => {
  const result = analyzeKeyDownSource(patchedSource)

  assert.equal(result.callsPerformKeyEquivalent, true)
  assert.equal(result.checksPerformKeyEquivalentReturnValue, true)
  assert.equal(result.hasCommandOrControlGuard, true)
  assert.equal(result.mentionsOptionExclusion, true)
  assert.equal(result.callsInterpretKeyEvents, true)
})

test('patches vulnerable Wry macOS keyDown source into guarded shape', () => {
  const source = `
use objc2_app_kit::{NSApplication, NSEvent, NSView, NSWindow, NSWindowButton};
use objc2_foundation::MainThreadMarker;
use objc2_foundation::NSRect;

${vulnerableSource}
`

  const patched = patchWryKeyDownSource(source)
  const result = analyzeKeyDownSource(patched)

  assert.match(patched, /NSEventModifierFlags/)
  assert.match(patched, /NSArray/)
  assert.equal(result.checksPerformKeyEquivalentReturnValue, true)
  assert.equal(result.hasCommandOrControlGuard, true)
  assert.equal(result.mentionsOptionExclusion, true)
  assert.equal(result.callsInterpretKeyEvents, true)
})

test('prepares a patched Wry source copy', () => {
  const root = mkdtempSync(join(tmpdir(), 'notegen-wry-keydown-test-'))
  const sourceRoot = join(root, 'wry-source')
  const outputRoot = join(root, 'wry-patched')
  const parentPath = join(sourceRoot, 'src', 'wkwebview', 'class')
  mkdirSync(parentPath, { recursive: true })
  writeFileSync(join(sourceRoot, 'Cargo.toml'), '[package]\nname = "wry"\nversion = "0.52.1"\n')
  writeFileSync(
    join(parentPath, 'wry_web_view_parent.rs'),
    [
      'use objc2_app_kit::{NSApplication, NSEvent, NSView, NSWindow, NSWindowButton};',
      'use objc2_foundation::MainThreadMarker;',
      'use objc2_foundation::NSRect;',
      vulnerableSource,
    ].join('\n'),
  )

  const result = preparePatchedWrySource({ sourceRoot, outputRoot })
  const patched = readFileSync(join(outputRoot, 'src', 'wkwebview', 'class', 'wry_web_view_parent.rs'), 'utf8')

  assert.equal(result.outputRoot, outputRoot)
  assert.equal(analyzeKeyDownSource(patched).hasCommandOrControlGuard, true)
})
