const VERSION_PATTERN = /(?:^|[^\d])v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/i
const NUMERIC_IDENTIFIER_PATTERN = /^\d+$/

export interface SemanticVersion {
  major: number
  minor: number
  patch: number
  prerelease: string[]
  text: string
}

export function extractVersionText(input: string | null | undefined) {
  const match = input?.match(VERSION_PATTERN)
  if (!match) return null

  const [, major, minor, patch, prerelease] = match
  const baseVersion = `${major}.${minor}.${patch}`

  return prerelease ? `${baseVersion}-${prerelease}` : baseVersion
}

export function parseVersion(input: string | null | undefined): SemanticVersion | null {
  const versionText = extractVersionText(input)
  if (!versionText) return null

  const [coreVersion, prereleaseText] = versionText.split('-', 2)
  const [major, minor, patch] = coreVersion.split('.').map(Number)

  if ([major, minor, patch].some((part) => !Number.isInteger(part) || part < 0)) {
    return null
  }

  return {
    major,
    minor,
    patch,
    prerelease: prereleaseText ? prereleaseText.split('.').filter(Boolean) : [],
    text: versionText,
  }
}

function comparePrerelease(left: string[], right: string[]) {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1

  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index]
    const rightPart = right[index]

    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue

    const leftIsNumeric = NUMERIC_IDENTIFIER_PATTERN.test(leftPart)
    const rightIsNumeric = NUMERIC_IDENTIFIER_PATTERN.test(rightPart)

    if (leftIsNumeric && rightIsNumeric) {
      const diff = Number(leftPart) - Number(rightPart)
      if (diff !== 0) return diff
      continue
    }

    if (leftIsNumeric) return -1
    if (rightIsNumeric) return 1

    return leftPart.localeCompare(rightPart)
  }

  return 0
}

export function compareVersions(
  leftInput: SemanticVersion | string | null | undefined,
  rightInput: SemanticVersion | string | null | undefined,
) {
  const left = typeof leftInput === 'string' || leftInput == null ? parseVersion(leftInput) : leftInput
  const right = typeof rightInput === 'string' || rightInput == null ? parseVersion(rightInput) : rightInput

  if (!left || !right) return 0

  const coreDiff =
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch

  if (coreDiff !== 0) return coreDiff

  return comparePrerelease(left.prerelease, right.prerelease)
}

export function isPrereleaseVersion(input: string | null | undefined) {
  return (parseVersion(input)?.prerelease.length ?? 0) > 0
}
