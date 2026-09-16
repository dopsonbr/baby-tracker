import { handler } from "../apps/api/src/handler.js"

// Vercel's Web Standard entrypoint; implementation stays in the API workspace.
export default { fetch: handler }
