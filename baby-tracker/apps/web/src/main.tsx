import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ClerkProvider } from "@clerk/react"
import "@workspace/ui/globals.css"
import { App } from "./App"
import { AuthenticatedApp, Welcome } from "./Auth"

const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const demo = import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE === "true"
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {demo ? (
      <App />
    ) : key ? (
      <ClerkProvider publishableKey={key} afterSignOutUrl="/">
        <AuthenticatedApp />
      </ClerkProvider>
    ) : (
      <Welcome configured={false} />
    )}
  </StrictMode>
)
