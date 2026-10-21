import { syncStaleError } from './sync-stale-error'

export type GitObjectType = 'blob' | 'tree' | 'commit'

export interface GitObject {
  oid: string
  type: GitObjectType
  content: Uint8Array
}

export interface GitTreeEntry {
  name: string
  mode: string
  oid: string
}

export interface ReceivePackAdvertisement {
  refs: Map<string, string>
  capabilities: Set<string>
}

type Packet = { kind: 'data', data: Uint8Array } | { kind: 'flush' }

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const ZERO_OID = '0'.repeat(40)
const MAX_PACKET_LENGTH = 65520
const objectTypes: Record<GitObjectType, number> = { commit: 1, tree: 2, blob: 3 }

function concatBytes(parts: readonly Uint8Array[]) {
  const length = parts.reduce((total, part) => total + part.length, 0)
  if (!Number.isSafeInteger(length)) throw new Error('Git data is too large')
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

function encodeText(value: string) {
  const bytes = encoder.encode(value)
  if (decoder.decode(bytes) !== value) throw new Error('Git text contains invalid Unicode')
  return bytes
}

function normalizeOid(value: string, allowZero = false) {
  if (!/^[0-9a-f]{40}$/i.test(value) || (!allowZero && value === ZERO_OID)) {
    throw new Error('Invalid SHA-1 Git object ID')
  }
  return value.toLowerCase()
}

function oidBytes(oid: string) {
  const normalized = normalizeOid(oid)
  return Uint8Array.from({ length: 20 }, (_, index) => parseInt(normalized.slice(index * 2, index * 2 + 2), 16))
}

async function sha1(bytes: Uint8Array) {
  if (!globalThis.crypto?.subtle) throw new Error('Git sync requires Web Crypto SHA-1 support')
  // Copy to an ArrayBuffer-backed view accepted by Web Crypto on all targets.
  const input = new Uint8Array(bytes.length)
  input.set(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-1', input)
  return new Uint8Array(digest)
}

export async function createGitObject(type: GitObjectType, content: Uint8Array): Promise<GitObject> {
  if (!Object.prototype.hasOwnProperty.call(objectTypes, type)) throw new Error('Unsupported Git object type')
  const copy = new Uint8Array(content.length)
  copy.set(content)
  const hash = await sha1(concatBytes([encodeText(`${type} ${copy.length}\0`), copy]))
  const oid = Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('')
  return { oid, type, content: copy }
}

function normalizeTreeMode(mode: string) {
  const normalized = mode.replace(/^0+/, '')
  if (!['40000', '100644', '100755', '120000', '160000'].includes(normalized)) {
    throw new Error(`Unsupported Git tree mode: ${mode}`)
  }
  return normalized
}

export function encodeGitTree(entries: readonly GitTreeEntry[]): Uint8Array {
  const names = new Set<string>()
  const prepared = entries.map(entry => {
    if (!entry.name || entry.name === '.' || entry.name === '..' || /[\0/]/.test(entry.name)) {
      throw new Error('Invalid Git tree entry name')
    }
    if (names.has(entry.name)) throw new Error(`Duplicate Git tree entry: ${entry.name}`)
    names.add(entry.name)
    const mode = normalizeTreeMode(entry.mode)
    const name = encodeText(entry.name)
    return {
      mode,
      name,
      oid: oidBytes(entry.oid),
      // Git compares directories as though their names ended with a slash.
      sortName: mode === '40000' ? concatBytes([name, new Uint8Array([47])]) : name,
    }
  })
  prepared.sort((left, right) => {
    for (let index = 0; index < Math.min(left.sortName.length, right.sortName.length); index++) {
      const difference = left.sortName[index] - right.sortName[index]
      if (difference) return difference
    }
    return left.sortName.length - right.sortName.length
  })
  return concatBytes(prepared.flatMap(entry => [encodeText(`${entry.mode} `), entry.name, new Uint8Array([0]), entry.oid]))
}

function encodeStoredZlib(content: Uint8Array) {
  // RFC 1950 + RFC 1951 stored blocks: deterministic, with no platform codecs.
  const blockCount = Math.max(1, Math.ceil(content.length / 65535))
  const result = new Uint8Array(2 + blockCount * 5 + content.length + 4)
  result.set([0x78, 0x01])
  let sourceOffset = 0
  let offset = 2
  let first = 1
  let second = 0
  for (let block = 0; block < blockCount; block++) {
    const length = Math.min(65535, content.length - sourceOffset)
    const complement = length ^ 0xffff
    result.set([block === blockCount - 1 ? 1 : 0, length & 0xff, length >>> 8, complement & 0xff, complement >>> 8], offset)
    offset += 5
    const chunk = content.subarray(sourceOffset, sourceOffset + length)
    result.set(chunk, offset)
    for (const byte of chunk) {
      first = (first + byte) % 65521
      second = (second + first) % 65521
    }
    sourceOffset += length
    offset += length
  }
  new DataView(result.buffer).setUint32(offset, ((second << 16) | first) >>> 0, false)
  return result
}

function encodePackObjectHeader(type: GitObjectType, size: number) {
  const bytes: number[] = []
  let remaining = Math.floor(size / 16)
  bytes.push((objectTypes[type] << 4) | (size % 16) | (remaining ? 0x80 : 0))
  while (remaining) {
    const next = remaining % 128
    remaining = Math.floor(remaining / 128)
    bytes.push(next | (remaining ? 0x80 : 0))
  }
  return new Uint8Array(bytes)
}

export async function encodeGitPack(objects: readonly GitObject[]): Promise<Uint8Array> {
  if (objects.length > 0xffffffff) throw new Error('Too many Git pack objects')
  const unique = new Map<string, GitObject>()
  for (const object of objects) {
    const verified = await createGitObject(object.type, object.content)
    if (verified.oid !== normalizeOid(object.oid)) throw new Error('Git object content does not match its SHA-1')
    unique.set(verified.oid, verified)
  }
  const header = new Uint8Array(12)
  header.set(encodeText('PACK'))
  const view = new DataView(header.buffer)
  view.setUint32(4, 2, false)
  view.setUint32(8, unique.size, false)
  const parts: Uint8Array[] = [header]
  for (const object of unique.values()) {
    parts.push(encodePackObjectHeader(object.type, object.content.length), encodeStoredZlib(object.content))
  }
  const pack = concatBytes(parts)
  return concatBytes([pack, await sha1(pack)])
}

function parsePackets(bytes: Uint8Array): Packet[] {
  const packets: Packet[] = []
  let offset = 0
  while (offset < bytes.length) {
    if (bytes.length - offset < 4) throw new Error('Truncated Git packet header')
    const prefix = String.fromCharCode(...bytes.subarray(offset, offset + 4))
    if (!/^[0-9a-f]{4}$/i.test(prefix)) throw new Error('Invalid Git packet header')
    const length = parseInt(prefix, 16)
    if (length === 0) {
      packets.push({ kind: 'flush' })
      offset += 4
      continue
    }
    if (length < 4 || length > MAX_PACKET_LENGTH) throw new Error('Unsupported Git packet length')
    if (offset + length > bytes.length) throw new Error('Truncated Git packet payload')
    packets.push({ kind: 'data', data: bytes.subarray(offset + 4, offset + length) })
    offset += length
  }
  return packets
}

function packetLine(packet: Packet) {
  if (packet.kind !== 'data') throw new Error('Unexpected Git flush packet')
  if (packet.data[0] >= 1 && packet.data[0] <= 3) throw new Error('Git server returned an unnegotiated sideband channel')
  let line: string
  try {
    line = decoder.decode(packet.data)
  } catch {
    throw new Error('Git server returned invalid UTF-8')
  }
  if (line.endsWith('\n')) line = line.slice(0, -1)
  if (!line || /[\r\n]/.test(line)) throw new Error('Invalid Git protocol line')
  if (line.startsWith('ERR ')) throw new Error(`Git server rejected the request: ${line.slice(4)}`)
  return line
}

function assertRef(ref: string) {
  if (!ref.startsWith('refs/') || ref.endsWith('/') || ref.endsWith('.') || ref.includes('//')
    || ref.includes('..') || ref.includes('@{') || /[\x00-\x20\x7f~^:?*\[\\]/.test(ref)
    || ref.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock'))) {
    throw new Error('Invalid Git reference name')
  }
  encodeText(ref)
}

function assertSha1Capabilities(capabilities: ReadonlySet<string>) {
  for (const capability of capabilities) {
    if (capability.startsWith('object-format=') && capability !== 'object-format=sha1') {
      throw new Error('Git sync supports only SHA-1 repositories')
    }
  }
}

export function parseReceivePackAdvertisement(bytes: Uint8Array): ReceivePackAdvertisement {
  const packets = parsePackets(bytes)
  if (!packets[0] || packetLine(packets[0]) !== '# service=git-receive-pack' || packets[1]?.kind !== 'flush') {
    throw new Error('Invalid Git receive-pack advertisement')
  }
  const refs = new Map<string, string>()
  const capabilities = new Set<string>()
  // Some empty repositories advertise only the service header and its flush.
  if (packets.length === 2) return { refs, capabilities }
  if (packets[packets.length - 1]?.kind !== 'flush') throw new Error('Git advertisement is missing its final flush')
  for (let index = 2; index < packets.length - 1; index++) {
    const line = packetLine(packets[index])
    const separator = line.indexOf('\0')
    let reference = line
    if (index === 2) {
      if (separator < 0) throw new Error('Git advertisement is missing its capabilities')
      reference = line.slice(0, separator)
      const advertised = line.slice(separator + 1)
      if (advertised && !/^[!-~]+(?: [!-~]+)*$/.test(advertised)) throw new Error('Invalid Git capabilities')
      for (const capability of advertised.split(' ').filter(Boolean)) capabilities.add(capability)
      assertSha1Capabilities(capabilities)
    } else if (separator !== -1) {
      throw new Error('Unexpected Git capabilities packet')
    }
    const match = /^([0-9a-f]{40}) (.+)$/i.exec(reference)
    if (!match) throw new Error('Invalid Git advertised reference')
    const oid = normalizeOid(match[1], true)
    const ref = match[2]
    if (ref === 'capabilities^{}') {
      if (index !== 2 || oid !== ZERO_OID || packets.length !== 4) throw new Error('Invalid empty Git repository advertisement')
      continue
    }
    if (oid === ZERO_OID) throw new Error('Invalid zero Git advertised reference')
    if (ref !== 'HEAD') assertRef(ref.endsWith('^{}') ? ref.slice(0, -3) : ref)
    if (refs.has(ref)) throw new Error('Duplicate Git advertised reference')
    refs.set(ref, oid)
  }
  return { refs, capabilities }
}

function encodePacket(bytes: Uint8Array) {
  const length = bytes.length + 4
  if (length > MAX_PACKET_LENGTH) throw new Error('Git packet is too large')
  return concatBytes([encodeText(length.toString(16).padStart(4, '0')), bytes])
}

export function encodeReceivePackRequest(
  oldOid: string,
  newOid: string,
  ref: string,
  pack: Uint8Array,
  capabilities: ReadonlySet<string>,
): Uint8Array {
  assertRef(ref)
  assertSha1Capabilities(capabilities)
  if (!capabilities.has('report-status')) throw new Error('Git server does not support report-status; safe sync is unavailable')
  if (pack.length < 32 || decoder.decode(pack.subarray(0, 4)) !== 'PACK' || new DataView(pack.buffer, pack.byteOffset, pack.byteLength).getUint32(4, false) !== 2) {
    throw new Error('Invalid Git v2 pack')
  }
  // Keep the requested capabilities minimal: report-status, with no sideband.
  const command = `${normalizeOid(oldOid, true)} ${normalizeOid(newOid)} ${ref}\0report-status\n`
  return concatBytes([encodePacket(encodeText(command)), encodeText('0000'), pack])
}

function isStaleRefReason(reason: string) {
  // Hooks and access rules can include arbitrary text; preserve their rejection.
  if (/hook|protect|permission|access denied|not allowed|forbidden|authoriz|authentic/i.test(reason)) return false
  return /cannot lock ref|unable to lock|failed to lock|reference (?:already exists|is missing|does not exist)|incorrect old value provided|non-fast-forward|stale (?:info|reference)|fetch first|is at [0-9a-f]{40} but expected [0-9a-f]{40}|(?:old|expected) (?:sha|oid|value).*(?:mismatch|does not match|changed)/i.test(reason)
}

export function assertReceivePackStatus(bytes: Uint8Array, ref: string, expectedOldOid?: string, path = ref): void {
  assertRef(ref)
  const packets = parsePackets(bytes)
  if (packets.length < 3 || packets[packets.length - 1]?.kind !== 'flush') {
    throw new Error('Git receive-pack did not return a complete report-status response')
  }
  const unpack = packetLine(packets[0])
  if (unpack !== 'unpack ok') {
    if (unpack.startsWith('unpack ')) throw new Error(`Git could not unpack the update: ${unpack.slice(7)}`)
    throw new Error('Git receive-pack did not confirm object unpacking')
  }
  let confirmed = false
  for (let index = 1; index < packets.length - 1; index++) {
    const line = packetLine(packets[index])
    if (confirmed) throw new Error('Git receive-pack returned unexpected additional reference statuses')
    if (line === `ok ${ref}`) {
      confirmed = true
      continue
    }
    const prefix = `ng ${ref} `
    if (line.startsWith(prefix)) {
      const reason = line.slice(prefix.length)
      if (!reason || /[\x00-\x1f\x7f]/.test(reason)) throw new Error('Invalid Git reference rejection')
      if (isStaleRefReason(reason)) {
        // Only the protocol's explicit old-value mismatch proves a current SHA.
        // Other rejections provide no reliable actual ref value.
        const mismatch = /\bis at ([0-9a-f]{40}) but expected ([0-9a-f]{40})\b/i.exec(reason)
        const expected = expectedOldOid !== undefined ? normalizeOid(expectedOldOid, true) : mismatch?.[2].toLowerCase()
        const actualOid = mismatch?.[1].toLowerCase()
        const actual = actualOid !== undefined
          ? actualOid === ZERO_OID ? { exists: false } : { sha: actualOid, exists: true }
          : /\breference (?:is missing|does not exist)\b/i.test(reason) ? { exists: false }
            : /\breference already exists\b/i.test(reason) ? { exists: true } : undefined
        throw syncStaleError({
          stage: 'apply', path, source: 'remote', check: 'gitRef',
          ...(expected !== undefined ? { expected: expected === ZERO_OID ? { exists: false } : { sha: expected, exists: true } } : {}),
          ...(actual ? { actual } : {}),
        })
      }
      throw new Error(`Git rejected ${ref}: ${reason}`)
    }
    throw new Error('Git receive-pack did not confirm the requested reference')
  }
  if (!confirmed) throw new Error('Git receive-pack did not confirm the requested reference')
}
