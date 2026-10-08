import { defineConfig } from "vite";

// relative base so the same build works on GitHub Pages under /liftKaraDe/
export default defineConfig({ base: "./", worker: { format: "es" } });
