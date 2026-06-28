import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import react from "eslint-plugin-react";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // ── No hard-coded user-facing JSX strings (i18n guard) ────────────────────
  // Every visible string must come from next-intl (useTranslations /
  // getTranslations), so a copy change can't silently ship English-only text.
  // We scope react/jsx-no-literals to the UI tree (app + components) and tune it
  // to flag only REAL words — whitespace, numbers and standalone punctuation /
  // glyphs (·, →, ✕, ✓, *, —, parentheses, arrows) are allowed so decorative
  // separators don't become noise. ignoreProps keeps attribute values
  // (className, aria-*, role, test ids) out of scope; only element children /
  // text are checked. The translated values live in messages/*.json and are
  // never linted as JSX.
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    plugins: { react },
    rules: {
      "react/jsx-no-literals": [
        "error",
        {
          noStrings: true,
          ignoreProps: true,
          allowedStrings: [
            "·",
            "—",
            "–",
            "→",
            "←",
            "✕",
            "✓",
            "⚠",
            "★",
            "▷",
            "↺",
            "⟳",
            "🐾",
            "*",
            "(",
            ")",
            "+",
            "?",
            ":",
            "/",
            "&",
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright artifacts (gitignored) — never lint generated reports/traces.
    "test-results/**",
    "playwright-report/**",
    "blob-report/**",
  ]),
]);

export default eslintConfig;
