import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Discord Activities require HTTPS — typically via cloudflared/ngrok pointed
// at this Vite dev server. The server proxies /api and /socket.io to the
// Fastify backend on :3001 so the same tunnel host serves both.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_TARGET ?? "http://localhost:3001";
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      // hmr config friendly to tunneling — allow any host header.
      host: true,
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
