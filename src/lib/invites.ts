// Pure invite-code logic (no Prisma / no I/O) so it can be unit-tested.
// Two concerns: (1) generating a human-friendly reusable "league invite" code,
// and (2) deciding whether a given code may be consumed by a new registration.
// The register route + admin API delegate here; see #110.

const LEAGUE_CODE_PREFIX = "GFL";

// Suffix alphabet with visually ambiguous characters (0/O, 1/I/L) removed, so a
// code copied out of a group chat is easy to read aloud / retype. 32 symbols.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** `GFL-2026-A7QK` — the prefix + year make it recognizable, the suffix keeps it unguessable-ish. */
export function formatLeagueCode(year: number, suffix: string): string {
  return `${LEAGUE_CODE_PREFIX}-${year}-${suffix}`;
}

/** Random suffix from the unambiguous alphabet. `rand` is injectable for tests. */
export function randomCodeSuffix(length = 4, rand: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * A fresh league code for the given year, e.g. `GFL-2026-A7QK`. It embeds the
 * year but is NOT tied to a Season row — the reusable link is rotated by the
 * admin (a new code disables the old one), which is how a per-season link is
 * achieved without resolving the broader year-over-year-accounts question.
 */
export function generateLeagueCode(year: number, rand: () => number = Math.random): string {
  return formatLeagueCode(year, randomCodeSuffix(4, rand));
}

export interface InviteState {
  multiUse: boolean;
  disabled: boolean;
  expiresAt: Date | null;
  maxUses: number | null;
}

export type InviteCheck = { ok: true } | { ok: false; error: string };

/**
 * Whether `invite` may be consumed by a new registration, given how many users
 * have already used it (`useCount`). Single-use codes reject once used; multi-use
 * codes reject only when disabled, expired, or at their optional cap.
 */
export function checkInviteUsable(
  invite: InviteState,
  useCount: number,
  now: Date = new Date()
): InviteCheck {
  if (invite.disabled) {
    return { ok: false, error: "This invite link has been disabled" };
  }
  if (invite.expiresAt && invite.expiresAt < now) {
    return { ok: false, error: "Invite code has expired" };
  }
  if (invite.multiUse) {
    if (invite.maxUses != null && useCount >= invite.maxUses) {
      return { ok: false, error: "This invite link has reached its limit" };
    }
    return { ok: true };
  }
  // Single-use: consumed once anyone registers with it.
  if (useCount > 0) {
    return { ok: false, error: "Invite code already used" };
  }
  return { ok: true };
}

/** Coerce an admin-supplied usage cap to a positive integer, or null (unlimited). */
export function normalizeMaxUses(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}
