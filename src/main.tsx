import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Zeigt bei einem Laufzeitfehler die Fehlermeldung an, statt nur eine leere Seite.
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return <div style={{ padding: 24, color: '#ffb4b4', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
      <b>Fehler in der App</b>{'\n\n'}{this.state.error.message}{'\n\n'}{this.state.error.stack}{'\n\n'}
      Meist liegt es an gemischten Dateiständen: bitte den kompletten Ordner src/ aus src-komplett.zip übernehmen und Strg+F5 drücken.
    </div>
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
