import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

function moveIndexHtmlPlugin() {
  const htmlFile = path.resolve(__dirname, "dist/gallery.html");
  return {
    name: "move-index-html",
    closeBundle() {
      const src = path.resolve(__dirname, "dist/gallery/index.html");
      if (fs.existsSync(src)) {
        fs.renameSync(src, htmlFile);
      }
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (
          req.url === "/gallery/" ||
          req.url === "/gallery" ||
          req.url === "/gallery.html"
        ) {
          res.setHeader("Content-Type", "text/html");
          fs.createReadStream(htmlFile).pipe(res);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: "/gallery/",
  publicDir: "public/gallery",
  plugins: [react(), moveIndexHtmlPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist/gallery",
  },
  preview: {
    open: "/gallery.html",
  },
});
