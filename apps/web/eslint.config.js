// ESLint flat config: type-aware TS rules plus the project bans (no any, no console,
// no dangerouslySetInnerHTML, no browser dialogs, no web storage for tokens).
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.parity', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is forbidden (CONTRACT §8).',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'confirm', message: 'Use a confirm modal instead.' },
        { name: 'alert', message: 'Use a toast or .msg instead.' },
        { name: 'prompt', message: 'Use a modal form instead.' },
        { name: 'localStorage', message: 'Tokens must stay in memory.' },
        { name: 'sessionStorage', message: 'Tokens must stay in memory.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'confirm' },
        { object: 'window', property: 'alert' },
        { object: 'window', property: 'prompt' },
        { object: 'window', property: 'localStorage' },
        { object: 'window', property: 'sessionStorage' },
      ],
    },
  },
  {
    // Phase 36: the new UI kit and the files redone for it use classes from styles/ui.css, never inline styles.
    files: ['src/ui/**/*.{ts,tsx}', 'src/components/ActionBar.tsx', 'src/pages/admin/UiKitPage.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is forbidden (CONTRACT §8).',
        },
        {
          selector: "JSXAttribute[name.name='style']",
          message: 'No inline styles in the UI kit: add a class to src/styles/ui.css (Phase 36 C1).',
        },
      ],
    },
  },
  {
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
);
