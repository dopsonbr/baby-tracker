import { useRef, useState } from "react"
import { Camera, ImagePlus, LoaderCircle, ScanLine, X } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { MAX_PHOTO_BYTES, type PhotoImage } from "@workspace/domain"
import "./photo-input.css"

const acceptedTypes = ["image/jpeg", "image/png", "image/webp"]
/** Resize and re-encode on device; original image/metadata are never uploaded. */
async function preparePhoto(file: File): Promise<PhotoImage> {
  if (!acceptedTypes.includes(file.type))
    throw new Error(
      "Choose a JPEG, PNG, or WebP photo. For HEIC, use a screenshot or export as JPEG."
    )
  if (file.size > 15 * 1024 * 1024)
    throw new Error("That photo is too large. Choose one smaller than 15 MB.")
  const bitmap = await createImageBitmap(file)
  try {
    if (
      !bitmap.width ||
      !bitmap.height ||
      bitmap.width * bitmap.height > 50_000_000
    )
      throw new Error("Choose a smaller photo of the board.")
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext("2d")
    if (!context)
      throw new Error(
        "This browser could not prepare your photo. Try another browser."
      )
    context.fillStyle = "white"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.88, 0.75, 0.6]) {
      const data = canvas.toDataURL("image/jpeg", quality)
      const base64 = data.slice(data.indexOf(",") + 1)
      if (base64.length * 0.75 <= MAX_PHOTO_BYTES)
        return { mimeType: "image/jpeg", base64 }
    }
    throw new Error("Try a closer crop of the board so the photo is smaller.")
  } finally {
    bitmap.close()
  }
}

export function PhotoInput({
  busy,
  sample,
  onScan,
  onChange,
}: {
  busy: boolean
  sample: boolean
  onScan: (image: PhotoImage, clarification: string) => Promise<void>
  onChange: () => void
}) {
  const camera = useRef<HTMLInputElement>(null)
  const upload = useRef<HTMLInputElement>(null)
  const selection = useRef(0)
  const [image, setImage] = useState<PhotoImage | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState("")
  const [clarification, setClarification] = useState("")
  async function select(file?: File) {
    if (!file) return
    const current = ++selection.current
    setPreparing(true)
    setError("")
    setImage(null)
    onChange()
    try {
      const next = await preparePhoto(file)
      if (current === selection.current) setImage(next)
    } catch (cause) {
      if (current === selection.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "We could not open that photo. Try another JPEG or PNG."
        )
    } finally {
      if (current === selection.current) setPreparing(false)
    }
  }
  return (
    <div className="photo-input">
      <input
        ref={camera}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        aria-label="Take a whiteboard photo"
        hidden
        style={{ display: "none" }}
        tabIndex={-1}
        disabled={busy || preparing}
        onChange={(event) => {
          void select(event.target.files?.[0])
          event.target.value = ""
        }}
      />
      <input
        ref={upload}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Upload a whiteboard photo"
        hidden
        style={{ display: "none" }}
        tabIndex={-1}
        disabled={busy || preparing}
        onChange={(event) => {
          void select(event.target.files?.[0])
          event.target.value = ""
        }}
      />
      <div className="photo-input-actions">
        <button
          type="button"
          disabled={busy || preparing}
          onClick={() => camera.current?.click()}
        >
          <Camera size={16} /> Take a photo
        </button>
        <button
          type="button"
          disabled={busy || preparing}
          onClick={() => upload.current?.click()}
        >
          <ImagePlus size={16} /> Upload a photo
        </button>
      </div>
      {preparing && (
        <p className="field-hint" role="status">
          Preparing your photo…
        </p>
      )}
      {error && (
        <p className="photo-error" role="alert">
          {error}
        </p>
      )}
      {image && (
        <div className="photo-preview">
          <div className="photo-preview-image">
            <img
              src={`data:${image.mimeType};base64,${image.base64}`}
              alt="Whiteboard photo to scan"
            />
            <button
              type="button"
              disabled={busy}
              aria-label="Remove photo"
              onClick={() => {
                selection.current++
                setImage(null)
                setClarification("")
                onChange()
              }}
            >
              <X size={17} />
            </button>
          </div>
          <label>
            Anything to clarify? <span>Optional</span>
            <input
              maxLength={1000}
              value={clarification}
              disabled={busy}
              onChange={(event) => {
                setClarification(event.target.value)
                onChange()
              }}
              placeholder="e.g. All times are AM; this is today’s board"
            />
          </label>
          <div className="photo-scan-row">
            <p>
              Review the times and ounces before saving. The photo itself won’t
              be saved.
            </p>
            <Button
              type="button"
              size="sm"
              disabled={busy || sample}
              onClick={() => void onScan(image, clarification)}
            >
              {busy ? <LoaderCircle className="spin" /> : <ScanLine />} Scan
              board
            </Button>
          </div>
          {sample && (
            <p className="field-hint">
              Photo scanning is available in the signed-in app. This sample
              stays on your device.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
