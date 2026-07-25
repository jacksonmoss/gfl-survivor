// Pure date/time formatting shared across the app so kickoff times render
// consistently and never omit their timezone. `Game.kickoff` is an absolute
// UTC instant, so this is purely a display concern.
//
// - UI (client): call `formatKickoff(date)` with no options — it uses the
//   browser's locale + timezone, and always appends a short zone label (e.g.
//   "Sun, Sep 7, 10:00 AM PDT") so the viewer can tell it's their local time.
// - Emails (no browser): pass an explicit `timeZone` (and a fixed `locale` for
//   deterministic output), e.g. `formatKickoff(date, { timeZone: "America/New_York", locale: "en-US" })`.

export interface FormatKickoffOptions {
  /** IANA zone (e.g. "America/New_York"). Omit to use the runtime default (browser local). */
  timeZone?: string;
  /** BCP-47 locale. Omit to use the runtime default; pass a fixed one for deterministic output (emails/tests). */
  locale?: string;
}

/**
 * Format a kickoff instant as "Sun, Sep 7, 10:00 AM PDT" — always including a
 * short timezone label so the zone is never ambiguous.
 */
export function formatKickoff(
  kickoff: Date | string,
  opts: FormatKickoffOptions = {},
): string {
  const date = typeof kickoff === "string" ? new Date(kickoff) : kickoff;
  return new Intl.DateTimeFormat(opts.locale, {
    timeZone: opts.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}
