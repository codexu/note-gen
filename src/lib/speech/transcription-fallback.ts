export const NO_TRANSCRIPTION_MESSAGE = 'No transcription. Configure a speech recognition model.'

export function getTranscriptionFallbackMessage(sttModel: string): string {
  return sttModel ? '' : NO_TRANSCRIPTION_MESSAGE
}
