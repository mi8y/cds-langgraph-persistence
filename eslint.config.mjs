// @ts-check

import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import cds from "@sap/eslint-plugin-cds";

export default defineConfig({
  files: ["src/**/*.{js,ts}", "**/*.cds"],
  extends: [
    js.configs.recommended,
    tseslint.configs.recommended,
    cds.configs.recommended,
    {
      rules: {
        "@typescript-eslint/no-unused-expressions": "off", // cds uses expressions for 'column' in queries
      },
    },
  ],
});
