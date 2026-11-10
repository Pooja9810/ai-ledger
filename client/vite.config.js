import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Forward any request starting with /api to the Express server.
    // The browser only ever talks to Vite (port 5173), so there's no CORS problem.
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
