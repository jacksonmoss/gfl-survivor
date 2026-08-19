import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";

/**
 * Is this install running in demo mode? (#161)
 *
 * The client can't read the flag itself: `DEMO_MODE` is a server env var by
 * design, because the beta stack runs a prebuilt production image and a
 * `NEXT_PUBLIC_` value would be frozen at build time. So the demo panel asks
 * here on mount and renders nothing when this says no.
 *
 * Always 200 — "demo mode is off" is an answer, not an error.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({ enabled: isDemoMode() });
}
