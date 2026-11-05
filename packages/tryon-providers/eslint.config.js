// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Decision D3: this package is server-only. Any reference to a browser global is a lint error,
// which (together with "browser": false in package.json) keeps provider code and keys out of
// the web bundle.
const BROWSER_GLOBALS = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'XMLHttpRequest'];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js', 'vitest.config.ts'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...BROWSER_GLOBALS.map((name) => ({
          name,
          message: `@curtain/tryon-providers is server-only (decision D3); do not reference ${name}.`,
        })),
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // The runtime guard has to mention `window` to detect a browser; `typeof` on an undeclared
    // global is safe, so the restriction is lifted for that one file only.
    files: ['src/serverOnly.ts', 'src/serverOnly.test.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
);
