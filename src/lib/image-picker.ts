export function pickImagesFromPhotoLibrary(options?: { multiple?: boolean }) {
  if (typeof document === 'undefined') {
    return Promise.resolve<File[]>([])
  }

  return new Promise<File[]>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = options?.multiple ?? false
    input.hidden = true

    const finish = (files: File[]) => {
      input.remove()
      resolve(files)
    }

    input.addEventListener('change', () => {
      finish(Array.from(input.files || []))
    }, { once: true })
    input.addEventListener('cancel', () => finish([]), { once: true })

    document.body.appendChild(input)
    input.click()
  })
}
