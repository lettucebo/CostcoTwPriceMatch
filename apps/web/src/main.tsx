import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App.js'
import { ReloadPrompt } from './components/ReloadPrompt.js'
import { IOSInstallHint } from './components/IOSInstallHint.js'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <ReloadPrompt />
        <IOSInstallHint />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
