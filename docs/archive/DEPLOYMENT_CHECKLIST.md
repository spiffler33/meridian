# Deployment Checklist for Spiffler.xyz Projects

Use this checklist when deploying any Vite/React project to a custom subdomain on spiffler.xyz.

## Pre-Deployment Checklist

### 1. Vite Base Path
**File:** `vite.config.ts`

```ts
export default defineConfig({
  plugins: [react()],
  base: '/',  // ✅ Use '/' for custom domains
  // base: '/repo-name/',  // ❌ Only for GitHub Pages without custom domain
})
```

### 2. CNAME File
**File:** `CNAME` (in repo root, or will be created in `dist/` during build)

```
yourproject.spiffler.xyz
```

If your build overwrites the CNAME, add it to `public/CNAME` so Vite copies it to `dist/`.

### 3. Environment Variables
**Check for:** Any `VITE_*` variables in your code

```bash
# Find all env vars used in your project
grep -r "import.meta.env.VITE_" src/
```

**Common ones:**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL`

### 4. GitHub Secrets
**Location:** `https://github.com/spiffler33/<repo>/settings/secrets/actions`

Add each `VITE_*` variable as a repository secret.

```bash
# Or via CLI:
gh secret set VITE_SUPABASE_URL --body "https://your-project.supabase.co"
gh secret set VITE_SUPABASE_ANON_KEY --body "your-anon-key"
```

### 5. GitHub Actions Workflow
**File:** `.github/workflows/deploy.yml`

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build
        env:
          # Add your VITE_* env vars here:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}

      - name: Setup Pages
        uses: actions/configure-pages@v4

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

### 6. GitHub Pages Settings
**Location:** `https://github.com/spiffler33/<repo>/settings/pages`

- Source: **GitHub Actions** (not "Deploy from branch")

### 7. DNS Configuration
In your DNS provider, add a CNAME record:
```
yourproject.spiffler.xyz → spiffler33.github.io
```

---

## Troubleshooting

### Blank Page
1. Open browser DevTools (F12) → Console
2. Look for errors like "supabaseUrl is required"
3. **Fix:** Add missing env vars to GitHub Secrets and workflow

### 404 on Assets
1. Check if paths show `/repo-name/assets/...` instead of `/assets/...`
2. **Fix:** Change `base` in `vite.config.ts` to `'/'`

### Old Version Still Showing
1. Hard refresh: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows)
2. Or test in incognito window

### Workflow Not Running
1. Check GitHub Pages source is set to "GitHub Actions"
2. Check workflow file is in `.github/workflows/` directory

---

## Quick Verification Commands

```bash
# Check vite base path
grep "base:" vite.config.ts

# Find env vars used
grep -r "import.meta.env.VITE_" src/

# Check if workflow exists
ls -la .github/workflows/

# List GitHub secrets (names only)
gh secret list

# Check recent workflow runs
gh run list --limit 5

# View workflow logs
gh run view <run-id> --log
```
