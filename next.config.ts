import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["snarkjs", "circomlibjs"],
  turbopack: {
    resolveAlias: {
      "worker_threads": "./src/lib/privacy/worker-threads-stub.ts",
    },
  },
};

export default nextConfig;
