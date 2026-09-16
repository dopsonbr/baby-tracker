/** Capture a detached, full-width copy. It never contains toolbar/account UI,
 * never uploads records, and uses local bundled fonts rather than remote ones. */
export async function createDayPicture(element: HTMLElement): Promise<Blob> {
  const { toBlob } = await import("html-to-image")
  await document.fonts.ready
  const clone = element.cloneNode(true) as HTMLElement
  clone.classList.add("paper-image-export")
  const holder = document.createElement("div")
  holder.setAttribute("aria-hidden", "true")
  Object.assign(holder.style, {
    position: "fixed",
    left: "-20000px",
    top: "0",
    width: "1000px",
    pointerEvents: "none",
  })
  holder.appendChild(clone)
  document.body.appendChild(holder)
  try {
    // A separate frame ensures container queries and fonts settle at export width.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const blob = await toBlob(clone, {
      backgroundColor: "#fffaf1",
      pixelRatio: 2,
      cacheBust: false,
      preferredFontFormat: "woff2",
    })
    if (!blob) throw new Error("The browser could not create a picture")
    return blob
  } finally {
    holder.remove()
  }
}
export async function saveDayPicture(
  element: HTMLElement,
  filename: string
): Promise<Blob> {
  const blob = await createDayPicture(element)
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename.replace(/[^a-zA-Z0-9._-]/g, "-")
  link.style.display = "none"
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return blob
}
