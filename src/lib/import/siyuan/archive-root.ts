interface ArchiveRootEntry {
  name: string
  isDirectory: boolean
  isSymlink?: boolean
}

export async function resolveSiYuanArchiveRootFromEntries(
  entries: ArchiveRootEntry[],
  extractedDirectory: string,
  joinPath: (base: string, segment: string) => Promise<string> | string,
): Promise<string> {
  if (entries.length !== 1) {
    throw new Error('Invalid SiYuan .sy.zip archive: expected one root directory.')
  }

  const [rootEntry] = entries
  if (!rootEntry.isDirectory || rootEntry.isSymlink) {
    throw new Error('Invalid SiYuan .sy.zip archive: root entry must be a directory.')
  }

  return joinPath(extractedDirectory, rootEntry.name)
}
