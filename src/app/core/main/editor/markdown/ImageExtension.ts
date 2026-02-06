'use client'

import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { uploadImage } from '@/lib/imageHosting'

export interface ImageOptions {
  inline: boolean
  allowBase64: boolean
  HTMLAttributes: Record<string, string>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    image: {
      setImage: (options: { src: string; alt?: string; title?: string }) => ReturnType
    }
  }
}

export const ImageExtension = Node.create<ImageOptions>({
  name: 'image',

  addOptions() {
    return {
      inline: true,
      allowBase64: true,
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      src: {
        default: null,
      },
      alt: {
        default: null,
      },
      title: {
        default: null,
      },
      'data-upload-status': {
        default: 'pending',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'img[src]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)]
  },

  addCommands() {
    return {
      setImage:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          })
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('imageUpload'),
        props: {
          handlePaste: (view, event, slice) => {
            const items = event.clipboardData?.items
            if (!items) return false

            for (const item of items) {
              if (item.type.indexOf('image') === 0) {
                const file = item.getAsFile()
                if (file) {
                  event.preventDefault()
                  const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY })
                  if (coordinates) {
                    this.uploadImage(view, file, coordinates.pos)
                  }
                  return true
                }
              }
            }
            return false
          },

          handleDrop: (view, event, slice, moved) => {
            if (!moved) {
              const files = event.dataTransfer?.files
              if (files && files.length > 0) {
                const file = files[0]
                if (file.type.indexOf('image') === 0) {
                  event.preventDefault()
                  const coordinates = view.posAtCoords({
                    left: event.clientX,
                    top: event.clientY,
                  })
                  if (coordinates) {
                    // Show placeholder decoration
                    const placeholder = document.createElement('span')
                    placeholder.className = 'image-upload-placeholder'
                    placeholder.innerHTML = '上传中...'
                    placeholder.setAttribute('contenteditable', 'false')

                    const decoration = Decoration.widget(coordinates.pos, {
                      node: placeholder,
                      side: -1,
                    })

                    const tr = view.state.tr.setMeta('image-upload', true)
                    view.dispatch(tr)

                    this.uploadImage(view, file, coordinates.pos)
                  }
                  return true
                }
              }
            }
            return false
          },
        },
      }),
    ]
  },

  uploadImage(view: any, file: File, pos: number) {
    const reader = new FileReader()
    reader.onload = async (e) => {
      const base64 = e.target?.result as string

      // Insert temporary image with pending status
      const { schema } = view.state
      const node = schema.nodes.image.create({
        src: base64,
        'data-upload-status': 'uploading',
      })
      const tr = view.state.tr.insert(pos, node)
      const imagePos = pos + 1
      view.dispatch(tr)

      try {
        // Upload to configured image hosting
        const url = await uploadImage(file)

        if (url) {
          // Update with uploaded URL
          const updateTr = view.state.tr.setNodeMarkup(imagePos, undefined, {
            src: url,
            'data-upload-status': 'uploaded',
          })
          view.dispatch(updateTr)
        } else {
          // If no image hosting configured, keep the base64
          const updateTr = view.state.tr.setNodeMarkup(imagePos, undefined, {
            src: base64,
            'data-upload-status': 'pending',
          })
          view.dispatch(updateTr)
        }
      } catch (error) {
        console.error('Image upload failed:', error)
        // Mark as failed
        const errorTr = view.state.tr.setNodeMarkup(imagePos, undefined, {
          src: base64,
          'data-upload-status': 'error',
        })
        view.dispatch(errorTr)
      }
    }
    reader.readAsDataURL(file)
  },
})
