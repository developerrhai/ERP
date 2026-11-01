// ESLint flat config for the registry package: strict, type-aware TypeScript rules.
// Exists so lint (part of `npm run verify`) enforces no-any and other quality gates (CONTRACT §10).
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", "registry.json"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": "error",
    },
  },
  { files: ["**/*.mjs"], ...tseslint.configs.disableTypeChecked },
);
