import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { FhevmProvider } from './components/FhevmProvider.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <FhevmProvider>
            <App />
        </FhevmProvider>
    </React.StrictMode>,
)
