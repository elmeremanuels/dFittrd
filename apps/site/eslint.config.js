import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // The site is a static page: no analytics, no third-party scripts (privacy-first, like the product).
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/googletagmanager|google-analytics|fonts\\.googleapis|fonts\\.gstatic|connect\\.facebook|hotjar|plausible\\.io/]',
          message: 'No trackers, font CDNs or third-party scripts on curtain.fit (docs/SITE.md).',
        },
      ],
    },
  },
  {
    files: ['src/client/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['scripts/**/*.ts', 'src/lib/**/*.ts', 'src/pages/**/*.ts', 'src/data/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
);
