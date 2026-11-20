import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import PinGate from './components/PinGate.jsx'
import { BigPictureProvider } from './bigpicture/BigPicture.jsx'
import './index.css'
import { startAutoUpdate } from './autoUpdate.js'

startAutoUpdate()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BigPictureProvider>
      <PinGate>
        {(me) => <App me={me} />}
      </PinGate>
    </BigPictureProvider>
  </React.StrictMode>
)
