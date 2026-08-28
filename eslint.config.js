import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    // ESLint 9 defaults this to `warn`, and `npm run lint` is judged by its
    // ERROR count — so a suppression left behind by the code it covered would
    // never move that number. An unused directive is dead weight that also
    // hides the rule coming back; make it fail like anything else.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
