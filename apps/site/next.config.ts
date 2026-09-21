import type { NextConfig } from "next";

// Deliberately plain: the marketing site shares no workspace packages, so it
// builds and deploys on its own without a database or a worker.
const nextConfig: NextConfig = {};
export default nextConfig;
