export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (typeof document === 'undefined') {
    return false
  }

  const targetNode = target instanceof Node ? target : null
  const targetElement =
    target instanceof HTMLElement
      ? target
      : targetNode?.parentElement ?? null
  const activeElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

  const isEditableElement = (element: HTMLElement | null): boolean => {
    if (!element) {
      return false
    }

    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement ||
      element.isContentEditable
    ) {
      return true
    }

    return !!element.closest(
      [
        'input',
        'textarea',
        'select',
        '[contenteditable]',
        '[role="textbox"]',
        '#aritcle-md-editor',
        '.tiptap-editor',
        '.ProseMirror',
      ].join(', ')
    )
  }

  return isEditableElement(targetElement) || isEditableElement(activeElement)
}
