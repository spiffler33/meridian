import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerSW } from 'virtual:pwa-register'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/**
 * Offline shell: precached app assets, updated in the background.
 *
 * `onNeedRefresh` reloads the page, and that is the whole point of wiring it.
 * `registerType: 'autoUpdate'` updates the WORKER — it does not re-execute a
 * page that is already open, and an installed PWA that is backgrounded and
 * resumed never reloads on its own. Measured the hard way: a fix deployed,
 * verified live, and the owner's phone kept running the old build for hours
 * while the number on screen stayed wrong.
 *
 * The reload is safe to do unannounced because every write is already durable
 * before it can happen — capture writes to the outbox before the line renders,
 * and the outbox survives a reload by construction. There is nothing unsaved
 * in this app to lose.
 *
 * Guarded so one bad worker cannot put the page in a reload loop: a refresh
 * only ever happens once per load.
 */
let refreshing = false
registerSW({
  immediate: true,
  onNeedRefresh() {
    if (refreshing) return
    refreshing = true
    window.location.reload()
  },
})
