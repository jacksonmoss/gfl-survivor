"use client";

import { useEffect, useState } from "react";
import { focusRing } from "@/lib/ui";
import { useToast } from "@/components/toast";

interface DemoWeek {
  id: string;
  weekNumber: number;
  label: string;
  games: { status: string }[];
}

/**
 * Demo-mode controls for the picks page (#161, multi-week in #163).
 *
 * A beta session lasts an hour; a season lasts five months. This is how a
 * customer gets to see the whole loop — make a pick, press one button, watch
 * everyone else's picks land, the games finish, and the leaderboard grade —
 * without waiting for a real Sunday. Playing several weeks at once is what
 * makes the season legible: standings move, streaks build, and used teams pile
 * up.
 *
 * Renders nothing unless the server says DEMO_MODE is on, so it's invisible in
 * a real league even though it ships in the same build. The flag can't be read
 * client-side (see src/lib/demo.ts), hence the fetch on mount.
 */
export function DemoPanel({
  weeks,
  selectedWeekId,
  hasPick,
  onChange,
}: {
  /** Every week of the active season, in order. */
  weeks: DemoWeek[];
  selectedWeekId: string | null;
  /** Whether the viewer has already picked the selected week — changes the prompt. */
  hasPick: boolean;
  onChange: () => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState<null | string>(null);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/demo")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => { if (!cancelled) setEnabled(!!d.enabled); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const week = weeks.find((w) => w.id === selectedWeekId) ?? null;
  if (!enabled || !week) return null;

  const isPlayed = (w: DemoWeek) => w.games.length > 0 && w.games.every((g) => g.status === "FINAL");
  const played = isPlayed(week);
  // Weeks the schedule hasn't reached yet have nothing to play out. Worth
  // saying rather than 400-ing: after simulating, the picks page auto-advances
  // to the next week on a refresh, which is usually an empty one.
  const empty = week.games.length === 0;

  // How many consecutive weeks from here still have a slate — the most a single
  // run can cover. Stops at the first week with no games, exactly like the API.
  const runLength = (() => {
    let n = 0;
    for (const w of weeks) {
      if (w.weekNumber < week.weekNumber) continue;
      if (w.games.length === 0) break;
      n++;
    }
    return n;
  })();

  const lastOfRun = weeks.find((w) => w.weekNumber === week.weekNumber + runLength - 1);
  const playedWeeks = weeks.filter(isPlayed).length;

  async function run(action: "simulate" | "reset", body: Record<string, unknown>, key: string) {
    if (!week) return;
    setBusy(key);
    try {
      const res = await fetch(`/api/demo/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekId: week.id, ...body }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Demo action failed");
        return;
      }
      const label =
        action === "simulate"
          ? data.weeksPlayed.length === 1
            ? data.weeksPlayed[0].label
            : `${data.weeksPlayed.length} weeks`
          : data.weeksReset.length === 1
          ? data.weeksReset[0]
          : `${data.weeksReset.length} weeks`;
      toast.success(
        action === "simulate"
          ? `${label} played out — ${data.picksCreated} picks made, ${data.graded} graded`
          : `${label} reopened — ${data.picksCleared} picks cleared`,
      );
      onChange();
    } catch {
      toast.error("Demo action failed");
    } finally {
      setBusy(null);
    }
  }

  const primary = `rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-all hover:bg-amber-500 active:scale-95 disabled:opacity-50 ${focusRing}`;
  const secondary = `rounded-lg border border-white/15 px-3 py-1.5 text-sm font-medium text-gray-200 transition-all hover:bg-white/10 active:scale-95 disabled:opacity-50 ${focusRing}`;

  return (
    <section
      aria-labelledby="demo-panel-heading"
      className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-3"
    >
      <div className="flex items-center gap-2">
        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
          Demo
        </span>
        <h2 id="demo-panel-heading" className="text-sm font-medium text-amber-100">
          {empty ? `${week.label} has no games` : played ? `${week.label} is played out` : `Play out ${week.label}`}
        </h2>
      </div>

      <p className="text-xs leading-relaxed text-amber-100/70">
        {empty
          ? "Pick a week with a schedule in the selector above to play one out."
          : played
          ? "Every game is final and every pick is graded — check the leaderboard and stats, then reopen the week to run it again."
          : hasPick
          ? "This picks at random for everyone who hasn't picked, plays the games, and grades the week — the same rules the live grader uses."
          : "Pick a team first, or the simulation will pick one for you at random along with everyone else. Then it plays the games and grades the week, using the same rules the live grader uses."}
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => run("simulate", { weeks: 1 }, "simulate-1")}
          disabled={busy !== null || empty}
          className={primary}
        >
          {busy === "simulate-1" ? "Simulating…" : "Simulate week"}
        </button>
        {runLength > 1 && (
          <button
            onClick={() => run("simulate", { weeks: runLength }, "simulate-run")}
            disabled={busy !== null}
            className={primary}
          >
            {busy === "simulate-run" ? "Simulating…" : `Simulate ${runLength} weeks`}
          </button>
        )}
        <button
          onClick={() => run("reset", {}, "reset-1")}
          disabled={busy !== null || empty}
          className={secondary}
        >
          {busy === "reset-1" ? "Resetting…" : "Reset week"}
        </button>
        {playedWeeks > 1 && (
          <button
            onClick={() => run("reset", { all: true }, "reset-all")}
            disabled={busy !== null}
            className={secondary}
          >
            {busy === "reset-all" ? "Resetting…" : "Reset all weeks"}
          </button>
        )}
      </div>

      {!empty && (
        <p className="text-[11px] text-amber-100/50">
          {runLength > 1
            ? `Simulating ${runLength} weeks plays ${week.label} through ${lastOfRun?.label ?? "the last scheduled week"} out one after another, a week apart, so standings and streaks build up. Reset clears everyone's picks for the week — yours included — and reopens its games.`
            : `Reset clears everyone's picks for ${week.label} — yours included — and reopens the games.`}
        </p>
      )}
    </section>
  );
}
