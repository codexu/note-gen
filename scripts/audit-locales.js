/**
 * Verifies that every key in messages/zh.json exists in all other locale files.
 * Exits with code 1 if any locale is missing keys.
 */

const fs = require('fs');
const path = require('path');

const MESSAGES_DIR = path.join(__dirname, '..', 'messages');
const LOCALES = ['en.json', 'ja.json', 'pt-BR.json', 'zh-TW.json'];

function getAllKeys(obj, prefix = '') {
  const keys = new Set();
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      for (const child of getAllKeys(v, full)) {
        keys.add(child);
      }
    } else {
      keys.add(full);
    }
  }
  return keys;
}

const zh = JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, 'zh.json'), 'utf-8'));
const zhKeys = getAllKeys(zh);

let failed = false;
for (const file of LOCALES) {
  const fullPath = path.join(MESSAGES_DIR, file);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ Missing locale file: ${file}`);
    failed = true;
    continue;
  }
  const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  const keys = getAllKeys(data);
  const missing = [];
  for (const k of zhKeys) {
    if (!keys.has(k)) {
      missing.push(k);
    }
  }
  if (missing.length > 0) {
    console.error(`❌ ${file} missing ${missing.length} key(s):`);
    missing.slice(0, 20).forEach((k) => console.error('   ' + k));
    if (missing.length > 20) {
      console.error(`   ... and ${missing.length - 20} more`);
    }
    failed = true;
  } else {
    console.log(`✅ ${file} has all ${zhKeys.size} keys`);
  }
}

process.exit(failed ? 1 : 0);
