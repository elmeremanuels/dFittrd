import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['out/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // docs/PREDICTION-ENGINE.md §2 test 3: the predictor imports nothing from capture, body or fit modules (also
    // src/predictBoundary.test.ts, which follows the imports transitively). Promoted later as @curtain/drape-prior.
    files: ['src/predict/**/*.ts'],
    ignores: ['src/predict/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@curtain/fit-engine', message: 'Sizing never depends on prediction (PREDICTION-ENGINE §2): the predictor must not import the fit engine.' },
            { name: '@curtain/mannequin', message: 'The predictor works in the mannequin\'s own terms; proxy.ts resolves them on mannequin M.' },
            { name: '@curtain/taste-engine', message: 'No shopper data enters the predictor (PREDICTION-ENGINE §10).' },
          ],
          patterns: [
            { group: ['../*', '!../features'], message: 'The predictor may import only src/predict/* and ../features (pure).' },
            { group: ['**/capture/**', '**/*body*', '**/*Body*', '**/*fit*', '**/*Fit*', 'node:*'], message: 'No capture, body or fit module, and no Node API, in the predictor (PREDICTION-ENGINE §2, §9).' },
          ],
        },
      ],
      // A namespace or default import (or `export *`) hides which names the predictor takes from @curtain/schema (AU_WOMENS_BODY_CHART
      // through `S['…']`): the predictor names every import, so the name checks above and in predictBoundary.test.ts see them.
      'no-restricted-syntax': [
        'error',
        { selector: 'ImportNamespaceSpecifier', message: 'Name each import in the predictor (no `import * as`): PREDICTION-ENGINE §2 test 3.' },
        { selector: 'ImportDefaultSpecifier', message: 'Name each import in the predictor (no default import): PREDICTION-ENGINE §2 test 3.' },
        { selector: 'ExportAllDeclaration[source.value=/^[^.]/]', message: 'No `export *` from a package in the predictor: PREDICTION-ENGINE §2 test 3.' },
      ],
    },
  },
);
