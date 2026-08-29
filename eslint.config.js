import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    // The config files themselves are ES modules with node globals; without
    // this they are silently never linted.
    files: ['**/*.js'],
    languageOptions: { globals: globals.node },
    extends: [js.configs.recommended],
  },
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
    rules: {
      // A context module exports its provider AND its hook; that is the
      // pattern, not an oversight. Fast refresh degrades to a full reload for
      // these two files in dev, which is the correct trade — splitting a
      // context in half to satisfy a dev-server optimisation would put the
      // hook and the thing it reads in different files forever.
      'react-refresh/only-export-components': 'off',
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
