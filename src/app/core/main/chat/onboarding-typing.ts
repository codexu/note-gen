export function buildTypingFrames(text: string, chunkSize: number) {
  const size = Math.max(1, chunkSize)
  const frames: string[] = []

  for (let index = size; index < text.length; index += size) {
    frames.push(text.slice(0, index))
  }

  frames.push(text)
  return frames
}
