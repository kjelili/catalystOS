import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

window.CATALYST_API_BASE =
  import.meta.env.VITE_CATALYST_API_BASE ||
  localStorage.getItem("catalyst_api_base") ||
  "";

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
