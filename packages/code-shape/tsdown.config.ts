import { defineConfig } from "tsdown";

// The build for npm: an ES module with its types in build/. The workspace runs the source (main is src/index.ts).
export default defineConfig({
  entry: { index: "src/index.ts" },
  outDir: "build",
  format: "esm",
  platform: "node",
  fixedExtension: false,
  sourcemap: true,
  dts: true,
  publint: true,
});
