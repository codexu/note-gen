const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bgh[opusr]_[A-Za-z0-9]{20,}\b/,
  /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|密码)\s*[:=：]\s*\S{8,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*\b/i,
]

export function containsPotentialSecret(content: string) {
  return SECRET_PATTERNS.some(pattern => pattern.test(content))
}

export function redactPotentialSecrets(content: string) {
  let redacted = content
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]')
  }
  return redacted
}
