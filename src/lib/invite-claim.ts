// Atomic invite claim + user creation (#123). Kept out of src/lib/invites.ts
// (which is pure/unit-tested) because this needs Prisma and a transaction.
//
// The pure `checkInviteUsable` decides *whether* a code may be used, but reading
// the use count and creating the user in separate queries lets two concurrent
// registrations both pass a capped multi-use code's check. Here the InviteCode
// row is locked FOR UPDATE first, so claims against the same code serialize:
// each one counts uses only after every earlier claim has committed.

import type { PrismaClient } from "@/generated/prisma/client";
import { checkInviteUsable } from "@/lib/invites";

export interface ClaimInviteInput {
  code: string;
  username: string;
  passwordHash: string;
  displayName: string;
  realName: string | null;
}

export type ClaimResult = { ok: true; userId: string } | { ok: false; error: string };

const USERNAME_TAKEN = "That username's taken — try another.";

/** Prisma surfaces a unique-constraint breach as P2002. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

/**
 * Claim `code` for a new user, atomically. Returns the same user-facing errors
 * the register route returned before, so behavior is unchanged in the common
 * (uncontended) case — this only closes the race.
 *
 * Takes the client as an argument (rather than importing the singleton) so the
 * integration test can point it at a throwaway database.
 */
export async function claimInviteAndCreateUser(
  client: PrismaClient,
  input: ClaimInviteInput,
  now: Date = new Date()
): Promise<ClaimResult> {
  try {
    return await client.$transaction(async (tx) => {
      // Serialize concurrent claims of this code. Anyone else claiming it blocks
      // here until we commit, so the count below can't go stale under our feet.
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "InviteCode" WHERE code = ${input.code} FOR UPDATE`;
      if (locked.length === 0) {
        return { ok: false, error: "Invalid invite code" };
      }

      const invite = await tx.inviteCode.findUnique({
        where: { code: input.code },
        include: { _count: { select: { usedBy: true } } },
      });
      if (!invite) {
        return { ok: false, error: "Invalid invite code" };
      }

      const usable = checkInviteUsable(invite, invite._count.usedBy, now);
      if (!usable.ok) {
        return { ok: false, error: usable.error };
      }

      // Re-checked inside the transaction: two registrations racing on the same
      // username would otherwise both pass the route's pre-check.
      const existing = await tx.user.findUnique({ where: { username: input.username } });
      if (existing) {
        return { ok: false, error: USERNAME_TAKEN };
      }

      const user = await tx.user.create({
        data: {
          username: input.username,
          passwordHash: input.passwordHash,
          displayName: input.displayName,
          realName: input.realName,
          inviteCodeUsed: invite.code,
        },
      });

      return { ok: true, userId: user.id };
    });
  } catch (err) {
    // Two transactions can still both pass the username check and collide at
    // commit; that's the same "taken" outcome, not a 500.
    if (isUniqueViolation(err)) {
      return { ok: false, error: USERNAME_TAKEN };
    }
    throw err;
  }
}
