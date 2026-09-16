// Transcription is deliberately independent of event interpretation. A future
// native or hosted provider can implement the same interface.
export interface TranscriptionProvider {
  start(
    onText: (text: string) => void,
    onError: (message: string) => void,
    onEnd: () => void
  ): () => void
}
interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>
      }) => void)
    | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}
export function browserTranscription(): TranscriptionProvider | null {
  const browser = window as typeof window & {
    SpeechRecognition?: new () => Recognition
    webkitSpeechRecognition?: new () => Recognition
  }
  const Constructor =
    browser.SpeechRecognition || browser.webkitSpeechRecognition
  if (!Constructor) return null
  return {
    start(onText, onError, onEnd) {
      const recognition = new Constructor()
      recognition.lang = "en-US"
      recognition.interimResults = false
      recognition.continuous = false
      recognition.onresult = (event) =>
        onText(
          Array.from(event.results)
            .map((result) => result[0]?.transcript || "")
            .join(" ")
        )
      recognition.onerror = (event) =>
        onError(
          event.error === "not-allowed"
            ? "Microphone access was declined. You can type your update instead."
            : "Could not hear that clearly. Please try again or type your update."
        )
      recognition.onend = onEnd
      recognition.start()
      return () => recognition.stop()
    },
  }
}
