/** @type {import('next').NextConfig} */
const nextConfig = {
  // Charts manage their own imperative lifecycle; double-invoke in dev breaks them.
  reactStrictMode: false,
  // Native Web Workers via `new Worker(new URL('./x.worker.ts', import.meta.url))`
  // are supported out of the box by the Next 15 / Turbopack + webpack pipeline.
};

export default nextConfig;
