import crypto from "crypto";

// Password reset tokens are single-use and short-lived. We store only a
// SHA-256 hash of the token in the DB; the raw token travels in the reset
// link so a DB leak can't be used to reset accounts.

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function resetTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + RESET_TOKEN_TTL_MS);
}

export function isResetTokenExpired(
  expiresAt: Date,
  now: Date = new Date()
): boolean {
  return now.getTime() > expiresAt.getTime();
}

// Temporary password for the admin last-resort reset. Avoids ambiguous
// characters (0/O, 1/l/I) so it can be read aloud or copied without error.
const TEMP_PW_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export function generateTempPassword(length = 12): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += TEMP_PW_ALPHABET[crypto.randomInt(0, TEMP_PW_ALPHABET.length)];
  }
  return out;
}
