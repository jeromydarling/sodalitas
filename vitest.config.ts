import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["{app,worker,db,domain,content,ai,emails,payments,sites}/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["reference/**", "node_modules/**", "build/**"],
  },
  resolve: {
    alias: {
      "~": new URL("./app", import.meta.url).pathname,
      "@db": new URL("./db", import.meta.url).pathname,
      "@domain": new URL("./domain", import.meta.url).pathname,
      "@worker": new URL("./worker", import.meta.url).pathname,
      "@content": new URL("./content", import.meta.url).pathname,
      "@emails": new URL("./emails", import.meta.url).pathname,
      "@ai": new URL("./ai", import.meta.url).pathname,
      "@payments": new URL("./payments", import.meta.url).pathname,
      "@sites": new URL("./sites", import.meta.url).pathname,
    },
  },
});
