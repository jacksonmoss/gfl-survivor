import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle at .next/standalone for slim Docker images.
  output: "standalone",
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
