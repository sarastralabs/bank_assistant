import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Bind IPv4 so Windows clients hitting 127.0.0.1 work reliably
    host: "127.0.0.1",
    proxy: {
      "/api": {
        // Prefer 127.0.0.1 — `localhost` often resolves to IPv6 (::1) on Windows
        // while uvicorn may only be reachable on IPv4.
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
