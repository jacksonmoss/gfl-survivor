import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Unauthenticated readiness probe hit by the Docker healthcheck (compose gates
// nginx on it via `service_healthy`). Cheap: a `SELECT 1` confirms the process
// is serving AND the DB is reachable, so nginx doesn't route traffic to an app
// that can't answer. Never cached — must reflect live state on every poll.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
