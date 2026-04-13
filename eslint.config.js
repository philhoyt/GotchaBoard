import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off',
      'prefer-const': 'warn',
      'eqeqeq': ['warn', 'always'],
      'no-var': 'warn',
    }
  },
  {
    files: ['server/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      // Server code uses catch (_) {} idiom throughout — suppress noise
      'no-empty': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    }
  },
  {
    ignores: ['dist/', 'node_modules/', 'extension/']
  }
];
