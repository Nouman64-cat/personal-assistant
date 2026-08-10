import type { NextConfig } from "next";

// Server-only — never exposed to the browser, unlike NEXT_PUBLIC_API_BASE_URL.
// Where the Next.js server itself reaches the backend, regardless of what
// public URL (localhost, LAN IP, ngrok tunnel, ...) the browser used to reach
// the Next.js server.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${BACKEND_URL}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
