export async function createNewNoteFromEmptyState({
  setLeftSidebarTab,
  newFile,
}: {
  setLeftSidebarTab: (tab: 'files' | 'notes') => void | Promise<void>
  newFile: () => void | Promise<void>
}) {
  await setLeftSidebarTab('files')
  await newFile()
}
