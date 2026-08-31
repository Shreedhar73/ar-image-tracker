import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Type-aware linting is scoped to **/*.ts on purpose: eslint.config.js and the
// .mjs build scripts are not in tsconfig's `include`, and the project service
// errors on any file it cannot find there.
const typeChecked = tseslint.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: ['**/*.ts'],
}))

export default tseslint.config(
  {ignores: ['dist', 'public/external', 'node_modules', '.vercel']},
  js.configs.recommended,
  ...typeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {projectService: true, tsconfigRootDir: import.meta.dirname},
    },
    rules: {
      // The XR8 boundary is untyped by design (see src/ar/xr8.ts); everywhere
      // else `any` is a bug, so this stays an error.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'art/**/*.mjs', 'tools/**/*.mjs', 'eslint.config.js'],
    languageOptions: {globals: globals.node},
  },
)
