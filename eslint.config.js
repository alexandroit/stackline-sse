import js from '@eslint/js';

export default [
  {
    ignores: ['coverage/**', 'dist/**', 'node_modules/**', 'site-dist/**']
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        AbortController: 'readonly',
        ArrayBuffer: 'readonly',
        Blob: 'readonly',
        console: 'readonly',
        FormData: 'readonly',
        Headers: 'readonly',
        performance: 'readonly',
        ReadableStream: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        TransformStream: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly'
      }
    },
    rules: {
      'no-console': ['error', { allow: ['error', 'log', 'warn'] }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    files: [
      'benchmark/**/*.mjs',
      'examples/**/*.mjs',
      'scripts/**/*.mjs',
      'test/**/*.mjs'
    ],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        process: 'readonly'
      }
    }
  },
  {
    files: ['docs-site/**/*.js'],
    languageOptions: {
      globals: {
        StacklineSSE: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        window: 'readonly'
      }
    }
  }
];
