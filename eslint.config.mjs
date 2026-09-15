import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Non-application code — tooling, skills, scripts, infra. Not app source.
      ".agent/**",
      ".agents/**",
      ".claude/**",
      "security-tools/**",
      "scripts/**",
      "loadtests/**",
      "audits/**",
      "docs/**",
      "supabase/**",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "import/no-anonymous-default-export": "off",
      "prefer-const": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/rules-of-hooks": "off",
      "@typescript-eslint/no-require-imports": "off",
      "react/no-unescaped-entities": "off",
      "react/no-children-prop": "off",
      "jsx-a11y/alt-text": "off",
      "@next/next/no-img-element": "off",
      "react-hooks/refs": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/immutability": "off",
      "@typescript-eslint/no-empty-object-type": "off",
    }
  }
];

export default eslintConfig;
