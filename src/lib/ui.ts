// Shared Tailwind class strings for the flat-dark design system, so the auth
// pages match the in-app card style (border-white/10 + bg-white/5) and share
// the same focus ring and button press feedback.
export const authInput =
  "mt-1 block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors";

export const authButton =
  "w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500 active:scale-95 disabled:opacity-50 transition-all";

// Standardized keyboard focus ring for interactive controls, tuned for the dark
// theme (blue ring on a gray-950 offset). `focus-visible` so it only shows for
// keyboard/AT users, not on mouse click. Use `focusRingInset` on controls that
// sit inside an `overflow-hidden` container (e.g. the split matchup buttons),
// where an offset ring would be clipped.
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950";

export const focusRingInset =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400";
