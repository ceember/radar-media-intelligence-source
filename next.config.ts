import type { NextConfig } from "next";

const productionCommit = process.env.SOURCE_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_SOURCE_COMMIT_SHA: productionCommit.length === 40 && /^[a-f0-9]{40}$/i.test(productionCommit)
      ? productionCommit.slice(0, 7).toLowerCase()
      : "",
  },
  // PGlite (WASM) e pdfkit (font AFM + dati) leggono file dal filesystem:
  // il bundling li romperebbe, restano esterni. L'SDK MCP porta con sé server
  // HTTP interi (express, hono): esterno anche lui, non va impacchettato.
  serverExternalPackages: ["@electric-sql/pglite", "pdfkit", "@modelcontextprotocol/sdk"],
};

export default nextConfig;
