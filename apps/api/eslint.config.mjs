// Lint rules for the API: type-aware TypeScript checks, no `any`, no console in app code.
// Prettier owns formatting, so its config turns off every stylistic ESLint rule.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint.config.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'error',
    },
  },
  {
    files: ['src/modules/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            'CallExpression[callee.name=/^(parseFloat|Number)$/][arguments.0.property.name=/^(amount|qty|rate|value)$/i]',
          message:
            'Do not use parseFloat() or Number() on amount, qty, rate, or value. Use Decimal (decimal.js) instead per STANDARDS §5.2.',
        },
      ],
    },
  },
  prettier,
);
