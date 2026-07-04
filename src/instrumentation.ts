// Runs once when a Next.js server instance starts, before it accepts requests.
// Used here as a production startup guard: fail fast if required secrets are missing.
export function register() {
  // Only meaningful on the Node.js server runtime, not the Edge runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.NODE_ENV === "production" && !process.env.NEXTAUTH_SECRET) {
    throw new Error(
      "NEXTAUTH_SECRET is not set. Generate one with `openssl rand -base64 32` " +
        "and provide it via the environment before starting the server in production.",
    );
  }
}
