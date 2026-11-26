import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  { ignores: [".next/**", "node_modules/**", "contracts/out/**", "public/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // beef's copy is lowercase prose full of apostrophes; react renders them correctly
      "react/no-unescaped-entities": "off",
      // existing database-row mapping and test doubles use `any`; flagged, not blocking
      "@typescript-eslint/no-explicit-any": "warn",
      // `{ secret, ...rest }` to drop fields is intentional
      "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true, argsIgnorePattern: "^_" }],
    },
  },
];
