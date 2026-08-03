import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { setupSimDatabase } from "../../prisma/sim-season";
import { claimInviteAndCreateUser } from "@/lib/invite-claim";

// Atomic invite claiming (#123). The cap can only be proven under real
// concurrency against a real database — the race lives between "count the uses"
// and "create the user", which no unit test with a fake client can reproduce.
//
// Gated on SIM_DATABASE_URL like the season simulator, but pointed at its own
// throwaway database so the two never fight over the same schema. Run locally:
//   SIM_DATABASE_URL=postgresql://gfl:gfl_dev_password@localhost:5433/gfl_sim pnpm test invite-claim
const SIM_DB_URL = process.env.SIM_DATABASE_URL;
const DB_URL = SIM_DB_URL
  ? (() => {
      const u = new URL(SIM_DB_URL);
      u.pathname = "/gfl_invite_test";
      return u.toString();
    })()
  : undefined;

describe.skipIf(!DB_URL)("atomic invite claim (DB-backed)", () => {
  let prisma: PrismaClient;
  let adminId: string;

  /** Fire N claims at once, each with its own username. */
  async function claimConcurrently(code: string, count: number) {
    return Promise.all(
      Array.from({ length: count }, (_, i) =>
        claimInviteAndCreateUser(prisma, {
          code,
          username: `racer${i}`,
          passwordHash: "hash",
          displayName: `Racer ${i}`,
          realName: null,
        })
      )
    );
  }

  async function createInvite(code: string, data: { multiUse: boolean; maxUses?: number | null }) {
    await prisma.inviteCode.create({
      data: { code, createdBy: adminId, multiUse: data.multiUse, maxUses: data.maxUses ?? null },
    });
  }

  beforeAll(async () => {
    await setupSimDatabase(DB_URL!);
    prisma = new PrismaClient({ adapter: new PrismaPg(DB_URL!) });
    const admin = await prisma.user.create({
      data: { username: "admin", passwordHash: "hash", displayName: "Admin", role: "ADMIN" },
    });
    adminId = admin.id;
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { id: { not: adminId } } });
    await prisma.inviteCode.deleteMany({});
  });

  it("never exceeds maxUses when registrations race", async () => {
    await createInvite("CAP3", { multiUse: true, maxUses: 3 });

    const results = await claimConcurrently("CAP3", 8);

    expect(results.filter((r) => r.ok)).toHaveLength(3);
    for (const r of results.filter((r) => !r.ok)) {
      expect(r).toEqual({ ok: false, error: "This invite link has reached its limit" });
    }
    // The users actually written match the cap — not just the returned results.
    expect(await prisma.user.count({ where: { inviteCodeUsed: "CAP3" } })).toBe(3);
  }, 30_000);

  it("lets only one registration consume a single-use code", async () => {
    await createInvite("SINGLE", { multiUse: false });

    const results = await claimConcurrently("SINGLE", 5);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const r of results.filter((r) => !r.ok)) {
      expect(r).toEqual({ ok: false, error: "Invite code already used" });
    }
    expect(await prisma.user.count({ where: { inviteCodeUsed: "SINGLE" } })).toBe(1);
  }, 30_000);

  it("still admits everyone through an uncapped multi-use code", async () => {
    await createInvite("OPEN", { multiUse: true, maxUses: null });

    const results = await claimConcurrently("OPEN", 6);

    expect(results.every((r) => r.ok)).toBe(true);
    expect(await prisma.user.count({ where: { inviteCodeUsed: "OPEN" } })).toBe(6);
  }, 30_000);

  it("rejects a disabled code and an unknown code", async () => {
    await prisma.inviteCode.create({
      data: { code: "OFF", createdBy: adminId, multiUse: true, disabled: true },
    });

    const disabled = await claimInviteAndCreateUser(prisma, {
      code: "OFF",
      username: "nope",
      passwordHash: "hash",
      displayName: "Nope",
      realName: null,
    });
    const missing = await claimInviteAndCreateUser(prisma, {
      code: "NOSUCHCODE",
      username: "nope2",
      passwordHash: "hash",
      displayName: "Nope",
      realName: null,
    });

    expect(disabled).toEqual({ ok: false, error: "This invite link has been disabled" });
    expect(missing).toEqual({ ok: false, error: "Invalid invite code" });
    expect(await prisma.user.count({ where: { username: { in: ["nope", "nope2"] } } })).toBe(0);
  }, 30_000);

  it("creates the user with the derived profile fields on a successful claim", async () => {
    await createInvite("HAPPY", { multiUse: true, maxUses: 5 });

    const result = await claimInviteAndCreateUser(prisma, {
      code: "HAPPY",
      username: "jdog",
      passwordHash: "hashed-pw",
      displayName: "Jackson",
      realName: "Jackson Moss",
    });

    expect(result.ok).toBe(true);
    const user = await prisma.user.findUnique({ where: { username: "jdog" } });
    expect(user).toMatchObject({
      displayName: "Jackson",
      realName: "Jackson Moss",
      passwordHash: "hashed-pw",
      inviteCodeUsed: "HAPPY",
    });
  }, 30_000);

  it("gives the second racer for a username the taken error, not a crash", async () => {
    await createInvite("DUPE", { multiUse: true, maxUses: null });

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        claimInviteAndCreateUser(prisma, {
          code: "DUPE",
          username: "sametaken",
          passwordHash: "hash",
          displayName: "Same",
          realName: null,
        })
      )
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const r of results.filter((r) => !r.ok)) {
      expect(r).toEqual({ ok: false, error: "That username's taken — try another." });
    }
    expect(await prisma.user.count({ where: { username: "sametaken" } })).toBe(1);
  }, 30_000);
});
