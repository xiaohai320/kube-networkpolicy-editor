import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { initI18n } from '@/i18n'

// Before the first render commits: components call `useTranslation()` in their
// render body, so the instance must exist by then.
initI18n()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
