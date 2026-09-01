import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Keep pdfjs-dist out of the server bundle: its internal dynamic import of
  // pdf.worker.mjs (fake-worker fallback used for server-side text
  // extraction) breaks when rewritten to a Turbopack/webpack chunk path.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
