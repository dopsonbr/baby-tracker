import { useState } from "react"
import { HandleSSOCallback, useAuth, useClerk, useSignIn } from "@clerk/react"
import { Heart, ArrowRight } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { App } from "./App"
import "./auth.css"

export function Welcome({ configured = true }: { configured?: boolean }) {
  return (
    <main className="welcome">
      <div className="welcome-mark">
        <Heart size={30} strokeWidth={1.5} />
      </div>
      <p className="welcome-eyebrow">LITTLE MOMENTS, ALL TOGETHER</p>
      <h1>
        Growing up,
        <br />
        <em>one day at a time.</em>
      </h1>
      <p className="welcome-copy">
        A little home for Beckett’s feeds, sleepy moments, and growing days.
        Just for your family.
      </p>
      {configured ? (
        <GoogleSignIn />
      ) : (
        <p role="status" className="welcome-status">
          Beckett is getting ready. Private family sign-in will be available
          once setup is complete.
        </p>
      )}
      <span className="welcome-footer">Made with love, for Beckett.</span>
    </main>
  )
}
function GoogleSignIn() {
  const { signIn, fetchStatus } = useSignIn()
  const [error, setError] = useState("")
  async function login() {
    setError("")
    try {
      const result = await signIn.sso({
        strategy: "oauth_google",
        redirectUrl: "/",
        redirectCallbackUrl: "/sso-callback",
      })
      if (result.error)
        setError(
          "We couldn’t sign you in. Please use an approved family Google account and try again."
        )
    } catch {
      setError("Google sign-in is unavailable right now. Please try again.")
    }
  }
  return (
    <>
      <Button
        className="welcome-login"
        disabled={fetchStatus === "fetching"}
        onClick={() => void login()}
      >
        Continue with Google <ArrowRight size={17} />
      </Button>
      <p className="welcome-private">
        Private access for approved family accounts.
      </p>
      {error && (
        <p role="alert" className="welcome-status">
          {error}
        </p>
      )}
      <div id="clerk-captcha" />
    </>
  )
}
export function AuthenticatedApp() {
  const { isLoaded, isSignedIn, getToken } = useAuth()
  const { signOut } = useClerk()
  if (!isLoaded)
    return (
      <main className="welcome">
        <p role="status">Opening Beckett’s day…</p>
      </main>
    )
  if (window.location.pathname === "/sso-callback")
    return (
      <HandleSSOCallback
        navigateToApp={() => {
          window.location.replace("/")
        }}
        navigateToSignIn={() => {
          window.location.replace("/?signin=retry")
        }}
        navigateToSignUp={() => {
          window.location.replace("/?signin=retry")
        }}
      />
    )
  return isSignedIn ? (
    <App
      getToken={getToken}
      signOut={() => {
        void signOut({ redirectUrl: "/" })
      }}
    />
  ) : (
    <Welcome />
  )
}
