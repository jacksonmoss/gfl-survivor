"use client";

// A template (unlike a layout) re-mounts on every navigation, so the wrapper
// replays its mount animation on each route change. Placed inside the (app)
// group's layout it wraps only the page content below the Navbar — the nav
// stays put while the page content fades/slides in. Cheap: opacity + transform
// only, and disabled under prefers-reduced-motion (see globals.css).
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-fade-in-up">{children}</div>;
}
