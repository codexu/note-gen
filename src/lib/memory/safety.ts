const SECRET_FIELD = String.raw`(?:\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd)|密码)\s*[:=：]`
const QUOTED_FIELD_VALUE = String.raw`"(?:\\.|[^"\\\r\n]){8,}"|'(?:\\.|[^'\\\r\n]){8,}'`
const UNQUOTED_FIELD_VALUE = String.raw`(?=\S{8})(?:(?![,;，；、](?=\s|$|${SECRET_FIELD}))\S)+`
const PEM_NEWLINE = String.raw`(?:\r\n|\r(?!\n)|\n|\\r\\n|\\r(?!\\n)|\\n)`
const PEM_BODY_LINE = String.raw`(?:[A-Za-z0-9+/]+={0,2}|(?:Proc-Type|DEK-Info):[^\r\n\\]*)`
const PEM_LINE_END = String.raw`(?:${PEM_NEWLINE}|["'\x60]|$)`
const PEM_PRIVATE_KEY = new RegExp([
  String.raw`-----BEGIN ((?:RSA |EC |DSA |ENCRYPTED |OPENSSH )?PRIVATE KEY)-----`,
  // Match a complete block first. If it was truncated, redact its consecutive PEM lines.
  String.raw`(?:(?:(?!-----BEGIN )[\s\S])*?-----END \1-----|`,
  String.raw`(?:[ \t]*[A-Za-z0-9+/]{8,}={0,2}(?=[ \t]|${PEM_LINE_END}))?`,
  String.raw`(?:${PEM_NEWLINE}[ \t]*(?:>[ \t]*)*`,
  String.raw`(?:${PEM_BODY_LINE}(?=[ \t]*${PEM_LINE_END})|(?=${PEM_NEWLINE})))*`,
  ')',
].join(''))

const SECRET_PATTERNS = [
  PEM_PRIVATE_KEY,
  /\bBearer\s+(?=[.~+/-]*\w)[A-Za-z0-9._~+/-]{16,}=*/i,
  new RegExp(String.raw`${SECRET_FIELD}\s*(?!${SECRET_FIELD}\s)(?:${QUOTED_FIELD_VALUE}|${UNQUOTED_FIELD_VALUE})`, 'i'),
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bgh[opusr]_[A-Za-z0-9]{20,}\b/,
]

export function containsPotentialSecret(content: string) {
  return SECRET_PATTERNS.some(pattern => pattern.test(content))
}

export function redactPotentialSecrets(content: string) {
  let redacted = content
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(new RegExp(pattern.source, `${pattern.flags}g`), '[REDACTED]')
  }
  return redacted
}
