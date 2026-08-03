import type { Config } from "@react-router/dev/config";

export default {
  // SSR everywhere. Public club pages and marketing are the organic-traffic
  // surface — they must render on the server for crawlers and AI assistants.
  ssr: true,
  future: {
    unstable_viteEnvironmentApi: true,
  },
} satisfies Config;
