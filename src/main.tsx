import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { initI18n } from '@/i18n'
import { getInitialTheme } from '@/hooks/useTheme'

// Before the first render commits: components call `useTranslation()` in their
// render body, so the instance must exist by then.
initI18n()

// The login page renders before the editor mounts its ThemeToggle, so the
// theme attribute must be set from storage here — otherwise the CSS `:root`
// default (dark) paints the gate dark and the toggle's light default flips
// the page on editor mount.
document.documentElement.setAttribute('data-theme', getInitialTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
