import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['app/dist/', 'node_modules/', 'test-results/', 'playwright-report/', '.wrangler/'] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
)
