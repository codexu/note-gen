/**
 * Regression guard: scans src/ for Chinese characters in UI-facing code.
 * Exits with code 1 if new hardcoded Chinese strings are found.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');

// Allow-list: strings that are intentionally Chinese (model names, comments, etc.)
const ALLOWLIST = new Set([
  '简体中文',
  '日本語',
]);

// Extensions to scan
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

function hasChinese(str) {
  return /[\u4e00-\u9fff]/.test(str);
}

function extractStringLiterals(line) {
  const strings = [];
  const singleQuote = /'((?:[^'\\]|\\.)*)'/g;
  const doubleQuote = /"((?:[^"\\]|\\.)*)"/g;
  const backtick = /`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = singleQuote.exec(line)) !== null) strings.push(m[1]);
  while ((m = doubleQuote.exec(line)) !== null) strings.push(m[1]);
  while ((m = backtick.exec(line)) !== null) strings.push(m[1]);
  return strings;
}

const violations = [];

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  let inBlockComment = false;
  lines.forEach((line, idx) => {
    // Track block comment state
    if (inBlockComment) {
      if (line.includes('*/')) {
        inBlockComment = false;
      }
      return;
    }
    if (line.includes('/*')) {
      inBlockComment = !line.includes('*/');
      if (inBlockComment) return;
    }

    // Skip import lines that load messages JSON (those contain locale codes, not UI)
    if (line.includes('messages/') && line.includes('import')) return;
    // Skip comment-only lines
    if (line.trim().startsWith('//')) return;

    const strings = extractStringLiterals(line);
    for (const str of strings) {
      if (!hasChinese(str)) continue;
      if (ALLOWLIST.has(str)) continue;
      violations.push(`${filePath}:${idx + 1}: ${str.slice(0, 60)}`);
    }

    // Also catch raw JSX text nodes (e.g. <span>保存</span>)
    const jsxTextRegex = />\s*([^<]*[\u4e00-\u9fff][^<]*)\s*</g;
    let jsxMatch;
    while ((jsxMatch = jsxTextRegex.exec(line)) !== null) {
      const text = jsxMatch[1].trim();
      if (ALLOWLIST.has(text)) continue;
      violations.push(`${filePath}:${idx + 1}: ${text.slice(0, 60)}`);
    }
  });
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walk(full);
    } else if (EXTENSIONS.has(path.extname(full))) {
      scanFile(full);
    }
  }
}

walk(SRC_DIR);

if (violations.length > 0) {
  console.error(`❌ Found ${violations.length} hardcoded Chinese string(s):`);
  violations.forEach((v) => console.error('   ' + v));
  process.exit(1);
} else {
  console.log('✅ No hardcoded Chinese strings found in src/');
  process.exit(0);
}
