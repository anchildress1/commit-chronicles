import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default defineConfig(
  { ignores: ['dist', 'coverage', 'node_modules', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.js', 'commitlint.config.js', 'playwright.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Warnings are hard errors in this repo; nothing ships with a lint complaint.
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The SVG renderer's whole job is interpolating computed coordinates into strings.
      // Wrapping every number in String() would be ceremony, not safety.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['src/client/**/*.tsx', 'src/client/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // Test doubles implement only the slice of an SDK the code under test calls, so the
    // rules that guard production boundaries would only force casts to be spelled louder.
    files: ['tests/**/*.ts', 'tests/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
