/* Main App Component - Handles routing (using react-router-dom), query client and other providers - use this file to add all routes */
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import Index from './pages/Index'
import TarefasPage from './pages/Tarefas'
import ConfiguracoesPage from './pages/Configuracoes'
import NotFound from './pages/NotFound'
import Layout from './components/Layout'

// ONLY IMPORT AND RENDER WORKING PAGES, NEVER ADD PLACEHOLDER COMPONENTS OR PAGES IN THIS FILE
// AVOID REMOVING ANY CONTEXT PROVIDERS FROM THIS FILE (e.g. TooltipProvider, Toaster, Sonner)

const AppLayout = () => (
  <Layout>
    <Outlet />
  </Layout>
)

const App = () => (
  <BrowserRouter>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Index />} />
          <Route path="/tarefas" element={<TarefasPage />} />
          <Route path="/configuracoes" element={<ConfiguracoesPage />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </TooltipProvider>
  </BrowserRouter>
)

export default App
