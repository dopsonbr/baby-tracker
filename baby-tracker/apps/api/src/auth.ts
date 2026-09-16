import { createClerkClient } from "@clerk/backend"
import { ApiError } from "./errors.js"
import { required, splitList } from "./config.js"

type PrivateUser = {
  banned?: boolean
  locked?: boolean
  emailAddresses: {
    emailAddress: string
    verification: { status: string } | null
  }[]
  externalAccounts: {
    provider: string
    emailAddress: string
    verification: { status: string } | null
  }[]
}
/** Exact addresses only: do not strip Gmail dots or plus aliases. */
export function isAllowedGoogleUser(
  user: PrivateUser,
  emails: string[]
): boolean {
  if (user.banned || user.locked) return false
  const allowed = new Set(
    emails.map((email) => email.trim().toLowerCase()).filter(Boolean)
  )
  return user.emailAddresses.some((email) => {
    const address = email.emailAddress.toLowerCase()
    return (
      email.verification?.status === "verified" &&
      allowed.has(address) &&
      user.externalAccounts.some(
        (account) =>
          (account.provider === "oauth_google" ||
            account.provider === "google") &&
          account.emailAddress.toLowerCase() === address &&
          account.verification?.status === "verified"
      )
    )
  })
}
export async function authenticate(request: Request): Promise<string> {
  const secretKey = required("CLERK_SECRET_KEY")
  const publishableKey =
    process.env.CLERK_PUBLISHABLE_KEY || required("VITE_CLERK_PUBLISHABLE_KEY")
  const allowed = splitList(required("ALLOWED_EMAILS"))
  const authorizedParties = [
    ...splitList(process.env.CLERK_AUTHORIZED_PARTIES ?? ""),
    ...[process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]
      .filter((value): value is string => Boolean(value))
      .map((host) => `https://${host}`),
  ]
  if (!allowed.length || !authorizedParties.length)
    throw new ApiError(
      503,
      "not_configured",
      "Private access is not configured."
    )
  if (!/^Bearer \S+$/i.test(request.headers.get("authorization") ?? ""))
    throw new ApiError(401, "unauthenticated", "Please sign in to continue.")
  const clerk = createClerkClient({ secretKey, publishableKey })
  const state = await clerk.authenticateRequest(request, {
    authorizedParties,
    acceptsToken: "session_token",
  })
  const auth = state.toAuth()
  if (!state.isAuthenticated || !auth?.userId)
    throw new ApiError(
      401,
      "unauthenticated",
      "Please sign in again to continue."
    )
  const user = await clerk.users.getUser(auth.userId)
  if (!isAllowedGoogleUser(user, allowed))
    throw new ApiError(
      403,
      "access_denied",
      "This app is private. Your Google account has not been given access."
    )
  return auth.userId
}
