import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle at .next/standalone for slim Docker images.
  output: "standalone",
  // Dev-only (#28): Next 16 blocks cross-origin requests to dev assets
  // (HMR, client chunks) from any host other than localhost. When testing on a
  // real phone via `pnpm dev:lan` (bound to 0.0.0.0), the browser's Origin is
  // the machine's LAN IP, so without this the client never hydrates and the
  // login form silently falls back to a native GET. These private-range
  // wildcards allow common home-LAN IPs (matcher is per-segment, `*` = one
  // segment). No effect on production builds.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "a.espncdn.com",
        pathname: "/i/teamlogos/nfl/**",
      },
    ],
  },
};

export default nextConfig;
