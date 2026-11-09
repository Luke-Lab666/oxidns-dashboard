import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// During `npm run dev`, /api is proxied to an OxiDNS API listener.
// Override with: OXIDNS_API=http://192.168.1.2:9199 npm run dev
const target = process.env.OXIDNS_API ?? "http://127.0.0.1:9199";

export default defineConfig({
  base: "./",
  plugins: [viteSingleFile()],
  server: { proxy: { "/api": { target, changeOrigin: true } } },
  build: { target: "es2020", cssCodeSplit: false, assetsInlineLimit: 100_000_000 },
});
