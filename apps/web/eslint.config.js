import js from '@eslint/js';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'dev-dist/**', 'node_modules/**', 'public/**', 'scripts/**', 'src/features/capture/scripts/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2023, ...globals.worker },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // AGENTS.md rule 2 / D3: nothing in the web bundle may name a provider key.
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value=/FASHN_API_KEY|XAI_API_KEY|SHOPIFY_API_SECRET|JWT_SECRET|GEMINI_API_KEY/]",
          message: 'Provider secrets never belong in the web app (DECISIONS.md D3).',
        },
      ],
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // Built by the capture agent; keep it lint-clean without rewriting it (reported in README).
    files: ['src/features/capture/**/*.{ts,tsx}'],
    rules: { 'react-hooks/purity': 'off', 'jsx-a11y/no-autofocus': 'off' },
  },
  {
    files: ['e2e/**/*.ts', 'src/**/*.test.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
  },
);
