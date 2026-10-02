import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  // Fixtures de Playwright usan `use()` que no es un hook de React.
  { files: ["e2e/**"], rules: { "react-hooks/rules-of-hooks": "off" } },
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Código generado por shadcn/ui: se actualiza con el CLI, no se edita a mano.
    "src/components/ui/**",
    "src/hooks/use-mobile.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
