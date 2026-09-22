import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Tipografías servidas desde el propio sitio (sin Google Fonts: la CSP solo permite 'self').
// Exponen "Plus Jakarta Sans Variable" y "JetBrains Mono Variable"; index.css las conecta con
// los nombres que usa theme.css.
import '@fontsource-variable/plus-jakarta-sans/wght.css'
import '@fontsource-variable/plus-jakarta-sans/wght-italic.css'
import '@fontsource-variable/jetbrains-mono/wght.css'
import '@fontsource-variable/jetbrains-mono/wght-italic.css'
import './index.css'
import AppRoot from './app/AppRoot.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
)
