/* Main App Component - Handles routing (using react-router-dom), query client and other providers - use this file to add all routes */
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/hooks/use-auth'
import { ProtectedLayout, PublicRoute } from './components/ProtectedRoute'
import Index from './pages/Index'
import TarefasPage from './pages/Tarefas'
import NomesControlePage from './pages/NomesControle'
import UsuariosPage from './pages/Usuarios'
import ConfiguracoesPage from './pages/Configuracoes'
import LoginPage from './pages/Login'
import NotFound from './pages/NotFound'

// ONLY IMPORT AND RENDER WORKING PAGES, NEVER ADD PLACEHOLDER COMPONENTS OR PAGES IN THIS FILE
// AVOID REMOVING ANY CONTEXT PROVIDERS FROM THIS FILE (e.g. TooltipProvider, Toaster, Sonner)

const App = () => (
  <BrowserRouter>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <Routes>
          {/* Tela de Login pública — redireciona para "/" se já autenticado */}
          <Route
            path="/login"
            element={
              <PublicRoute>
                <LoginPage />
              </PublicRoute>
            }
          />

          {/* Rotas protegidas — exigem sessão ativa; sem sessão vão para /login */}
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<Index />} />
            <Route path="/tarefas" element={<TarefasPage />} />
            <Route path="/tabelas/nomes" element={<NomesControlePage />} />
            <Route path="/tabelas/usuarios" element={<UsuariosPage />} />
            <Route path="/configuracoes" element={<ConfiguracoesPage />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </TooltipProvider>
    </AuthProvider>
  </BrowserRouter>
)

export default App
