import js from '@eslint/js';
import prettier from 'eslint-plugin-prettier';
import configPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'data/', 'finetune/'] },
  js.configs.recommended,
  configPrettier,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      prettier: prettier,
    },
    rules: {
      'prettier/prettier': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-undef': 'error',
    },
  },
];
