/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import tsconfigPaths from "vite-tsconfig-paths";
import { builtinModules } from "module";
import pkg from "./package.json";

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    dts({
      insertTypesEntry: true, // Automatically links types in package.json
      include: ["src"],
    }),
  ],

  // Build Configuration
  build: {
    minify: false, // disable since this is a node library
    lib: {
      entry: "src/index.ts",
      name: "@mi8y/cds-plugin-langgraph",
      fileName: "index",
      formats: ["es", "cjs"],
    },
    sourcemap: true,
    rolldownOptions: {
      external: [
        // ignore dependencies when bundling
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.peerDependencies || {}),
      ],
    },
  },

  // Testing Configuration (Vitest)
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.ts"],
    coverage: {
      provider: "v8",
      exclude: ["@cds-models/"],
      reporter: ["cobertura"],
      reportsDirectory: "coverage",
    },
  },
});
