import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages export TypeScript source; let Next compile them.
  transpilePackages: ["@distribution/core", "@distribution/db", "@distribution/jobs", "@distribution/storage"],
  // Native/Node-only modules stay external to the server bundle.
  serverExternalPackages: ["pg", "pg-boss", "sharp", "argon2", "pino", "drizzle-orm"],
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
