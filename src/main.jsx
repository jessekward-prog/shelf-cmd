import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import PinGate from './components/PinGate.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PinGate>
      <App />
    </PinGate>
  </React.StrictMode>
)
