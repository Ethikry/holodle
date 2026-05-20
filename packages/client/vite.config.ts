import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Discord Activities require HTTPS — typically via cloudflared/ngrok pointed
// at this Vite dev server. The server proxies /api and /socket.io to the
// Fastify backend on :3001 so the same tunnel host serves both.
//
// Both the server and the client read a single .env at the repo root.
// envDir below makes Vite pick it up; the server loads it via env.ts.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const apiTarget = env.VITE_API_TARGET ?? "http://localhost:3001";
  return {
    plugins: [react()],
    envDir: repoRoot,
    server: {
      port: 5173,
      strictPort: true,
      // hmr config friendly to tunneling — allow any host header.
      host: true,
      // Vite 6+ defaults to blocking non-localhost Host headers. cloudflared
      // tunnels rotate hostnames every restart, so allow all in dev.
      allowedHosts: true,
      cors: true,
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true },
        "/socket.io": { target: apiTarget, changeOrigin: true, ws: true },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
  };
});
