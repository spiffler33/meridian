# Life Calendar

A personal "life cockpit" web app for daily execution and long-term perspective. Built for focus, clarity, and low-friction daily tracking.

## Features

- **Today View**: Set 2-3 Most Important Things (MITs) across Work, Self/Health, and Family categories
- **Habit Tracking**: Toggle daily anchors (movement, strength, sleep, coding, family time, etc.)
- **Daily Reflection**: Quick journaling with auto-save
- **Week View**: Weekly overview with summaries and progress indicators
- **Year View**: GitHub-style contribution heatmap based on habit completion
- **Keyboard Shortcuts**: Quick navigation (T, W, Y, arrow keys)
- **Local Storage**: All data stays on your device
- **Export/Import**: JSON backup for data portability

## Tech Stack

- Vite + React + TypeScript
- Tailwind CSS
- localStorage for persistence
- No backend required

## Development

### Prerequisites

- Node.js 20.19+ or 22.12+ (recommended)
- npm

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd calendar

# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:5173/calendar/`

### Build

```bash
npm run build
```

The production build will be in the `dist/` folder.

## Deployment to GitHub Pages

### Option 1: Manual deployment

1. Build the project:
   ```bash
   npm run build
   ```

2. Deploy the `dist/` folder to your GitHub Pages branch.

### Option 2: GitHub Actions (Recommended)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: write
      id-token: write

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Setup Pages
        uses: actions/configure-pages@v4

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: './dist'

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

3. Enable GitHub Pages in your repository settings:
   - Go to Settings > Pages
   - Under "Source", select "GitHub Actions"

4. Push to main branch to trigger deployment.

### Configuration

The app is configured to deploy to `/calendar/` path. If your repository has a different name, update `vite.config.ts`:

```typescript
export default defineConfig({
  // ...
  base: '/your-repo-name/',
})
```

For a custom domain or root deployment, use:

```typescript
base: '/'
```

## Project Structure

```
src/
├── components/       # Reusable UI components
│   ├── DateNavigation.tsx
│   ├── HabitGrid.tsx
│   ├── Layout.tsx
│   ├── MitSection.tsx
│   └── Reflection.tsx
├── hooks/            # Custom React hooks
│   ├── useKeyboardShortcuts.ts
│   └── useNavigation.ts
├── store/            # State management
│   └── AppContext.tsx
├── types/            # TypeScript type definitions
│   └── index.ts
├── utils/            # Helper functions
│   ├── dates.ts
│   └── storage.ts
├── views/            # Page-level components
│   ├── SettingsView.tsx
│   ├── TodayView.tsx
│   ├── WeekView.tsx
│   └── YearView.tsx
├── App.tsx           # Root component
├── index.css         # Global styles & Tailwind config
└── main.tsx          # Entry point
```

## Customization

### Habits

Default habits can be modified in `src/types/index.ts` under `DEFAULT_HABITS`. You can also edit habits in the Settings view.

### Colors

The color palette is defined in `src/index.css` under the `@theme` block:
- `--color-accent-*`: Primary accent color (warm amber)
- `--color-surface-*`: Neutral background/text colors
- `--color-heat-*`: Heatmap intensity colors

### Week Start Day

Configure in Settings whether weeks start on Monday or Sunday.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `T` | Go to Today view |
| `W` | Go to Week view |
| `Y` | Go to Year view |
| `S` | Go to Settings |
| `←` | Previous day |
| `→` | Next day |

## Data Model

All data is stored in `localStorage` under the key `life-calendar-data`. The structure:

```typescript
interface AppState {
  settings: {
    habits: HabitDefinition[];
    yearThemes: YearTheme[];
    weekStartsOn: 0 | 1;
  };
  dailyData: Record<string, DailyData>;
}

interface DailyData {
  date: string;
  mit: {
    work: TodoItem[];
    self: TodoItem[];
    family: TodoItem[];
  };
  habits: Record<string, boolean>;
  reflection: string;
}
```

## License

MIT
