// Pure validation for team create/rename. Kept out of the API route so it can
// be unit-tested without Prisma/NextAuth (see src/__tests__/teams.test.ts).

export type TeamNameCheck =
  | { ok: true; name: string }
  | { ok: false; error: string };

/**
 * Validate a proposed team name against the (optional) team that already holds
 * that name. `selfId` is the id of the team being renamed, so renaming a team
 * to its own current name is allowed (not treated as a collision).
 *
 * - trims whitespace; blank/whitespace-only → "Team name is required"
 * - a different team owning the name → "Team name already taken"
 */
export function validateTeamName(
  raw: string | undefined | null,
  existing: { id: string } | null,
  selfId?: string,
): TeamNameCheck {
  const name = raw?.trim();
  if (!name) return { ok: false, error: "Team name is required" };
  if (existing && existing.id !== selfId) {
    return { ok: false, error: "Team name already taken" };
  }
  return { ok: true, name };
}
