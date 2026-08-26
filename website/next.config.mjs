import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // This website lives in a subfolder of the pattern-mcp repo, which has
  // its own package-lock.json -- without this, Next.js infers the repo
  // root as the workspace root and warns on every build.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
