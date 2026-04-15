import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

const rootDir = path.resolve(".");
const htmlEntries = [
  "index.html",
  "admin/index.html",
  "admin/alerts/index.html",
  "admin/candidates/index.html",
  "admin/feeds/index.html",
  "admin/jobs/index.html",
  "admin/topics/index.html",
  "app/index.html",
  "app/nutrition/index.html",
  "app/nutrition/index-v2.html",
  "app/profile/index.html",
  "app/profile/index-v2.html",
  "app/train/index.html",
  "app/progress/index.html",
  "app/progress/index-v2.html",
  "app/progress/exercise/index.html",
  "app/progress/session/index.html",
  "app/workout/index.html",
  "app/workout/cardio/index.html",
  "app/workout/climb/index.html",
  "app/workout/session/index.html",
  "app/workout/swim/index.html",
  "auth/callback/index.html",
  "auth/forgot-password/index.html",
  "auth/login/index.html",
  "auth/reset-password/index.html",
  "auth/signup/index.html",
  "auth/index.html",
  "chat/index.html",
  "contact/index.html",
  "demo/index.html",
  "privacy/index.html",
  "terms/index.html",
];

function copyStaticFiles(files) {
  return {
    name: "copy-static-files",
    closeBundle() {
      const outDir = path.join(rootDir, "dist");
      for (const relativeFile of files) {
        const source = path.join(rootDir, relativeFile);
        if (!fs.existsSync(source)) continue;
        const target = path.join(outDir, relativeFile);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
      }
    },
  };
}

export default defineConfig({
  appType: "mpa",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: Object.fromEntries(
        htmlEntries.map((relativePath) => [relativePath, path.join(rootDir, relativePath)])
      ),
    },
  },
  plugins: [
    copyStaticFiles([
      "emersus-logo.png",
    ]),
  ],
});
