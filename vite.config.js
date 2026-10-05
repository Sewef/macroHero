import { defineConfig } from "vite";
import { resolve } from "path";

// https://vite.dev/config/
export default defineConfig({
  optimizeDeps: {
    // Pre-bundle the editor and its CommonJS source-map dependency together
    // so Vite provides the default-export interop expected by the editor.
    include: ["vanilla-jsoneditor", "json-source-map"],
    needsInterop: ["json-source-map"],
  },
  server: {
    cors: {
      origin: "https://www.owlbear.rodeo",
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        configModal: resolve(__dirname, "configModal.html")
      }
    }
  }
});
