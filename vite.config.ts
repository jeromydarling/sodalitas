import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: {
    alias: {
      "~": new URL("./app", import.meta.url).pathname,
      "@db": new URL("./db", import.meta.url).pathname,
      "@domain": new URL("./domain", import.meta.url).pathname,
      "@worker": new URL("./worker", import.meta.url).pathname,
      "@content": new URL("./content", import.meta.url).pathname,
    },
  },
  build: {
    rollupOptions: {
      // The Anthropic SDK is server-only. Keeping it out of the client bundle
      // is a house rule — see reference/cros: the same mistake bloated CROS.
      external: (id) => id === "@anthropic-ai/sdk",
    },
  },
});
