import { createServer } from "node:http"
import { handler } from "./handler.js"
const port = Number(process.env.API_PORT ?? 3001)
createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 16384) {
        res.writeHead(413)
        res.end("Request too large")
        return
      }
      chunks.push(chunk)
    }
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers))
      if (value)
        headers.set(key, Array.isArray(value) ? value.join(",") : value)
    const body = Buffer.concat(chunks)
    const request = new Request(
      `http://${req.headers.host ?? `localhost:${port}`}${req.url}`,
      { method: req.method, headers, ...(body.length ? { body } : {}) }
    )
    const result = await handler(request)
    res.writeHead(result.status, Object.fromEntries(result.headers))
    res.end(Buffer.from(await result.arrayBuffer()))
  } catch {
    res.writeHead(500)
    res.end("Server error")
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`Beckett API listening on http://127.0.0.1:${port}`)
)
