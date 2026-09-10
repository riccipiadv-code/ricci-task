/* 404 Page - Displays when a user attempts to access a non-existent route - translate to the language of the user */
import { useLocation } from 'react-router-dom'
import { useEffect } from 'react'

const NotFound = () => {
  const location = useLocation()

  useEffect(() => {
    console.error('404 Error: User attempted to access non-existent route:', location.pathname)
  }, [location.pathname])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-4">
      <div className="text-center max-w-md bg-card border border-border p-8 rounded-2xl shadow-card">
        <h1 className="text-5xl font-extrabold text-primary mb-2">404</h1>
        <h2 className="text-xl font-bold mb-2">Página não encontrada</h2>
        <p className="text-sm text-muted-foreground mb-6">
          A rota que você tentou acessar não existe ou foi movida.
        </p>
        <a
          href="/"
          className="inline-flex items-center justify-center h-10 px-5 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
        >
          Voltar ao Dashboard
        </a>
      </div>
    </div>
  )
}

export default NotFound
