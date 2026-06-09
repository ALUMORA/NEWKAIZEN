import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  state = { err: null, info: null };
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { this.setState({ err, info }); }
  render() {
    if (this.state.err) return (
      <div style={{ padding: 32, fontFamily: 'monospace', background: '#fff', minHeight: '100vh', color: '#111' }}>
        <div style={{ color: '#dc2626', fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
          ⚠️ Error de renderizado — KAIZEN
        </div>
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: 16, marginBottom: 12, fontSize: 13 }}>
          <b>{String(this.state.err)}</b>
        </div>
        <pre style={{ fontSize: 11, color: '#666', whiteSpace: 'pre-wrap', marginBottom: 16 }}>
          {this.state.err?.stack}
        </pre>
        <button
          onClick={() => { this.setState({ err: null, info: null }); window.location.reload(); }}
          style={{ background: '#111', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 14, cursor: 'pointer' }}
        >
          Recargar página
        </button>
      </div>
    );
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
