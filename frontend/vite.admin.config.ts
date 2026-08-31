import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Serve admin.html as / so the Admin React app feels like a normal SPA. */
function adminRootPlugin(): Plugin {
  return {
    name: "admin-root-spa",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? "";
        if (url === "/" || url.startsWith("/?")) {
          req.url = "/admin.html";
        }
        next();
      });
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (ctx.path?.endsWith("admin.html") || ctx.filename?.endsWith("admin.html")) {
          return html.replace(
            "<title>Admin · Kannada Voice Banking</title>",
            "<title>Admin · ಕನ್ನಡ ವಾಯ್ಸ್ ಬ್ಯಾಂಕಿಂಗ್</title>",
          );
        }
        return html;
      },
    },
    generateBundle(_options, bundle) {
      // Emit admin.html as index.html in dist-admin
      const adminChunk = bundle["admin.html"];
      if (adminChunk && adminChunk.type === "asset") {
        this.emitFile({
          type: "asset",
          fileName: "index.html",
          source: adminChunk.source,
        });
      }
    },
  };
}

/** Staff Admin React SPA — http://127.0.0.1:5174/ */
export default defineConfig({
  plugins: [react(), adminRootPlugin()],
  server: {
    port: 5174,
    strictPort: true,
    host: "127.0.0.1",
    open: "/",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: "dist-admin",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        admin: "admin.html",
      },
    },
  },
});
