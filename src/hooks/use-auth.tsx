import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { User, Session, AuthError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'

interface AuthContextType {
  user: User | null
  session: Session | null
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>
  signOut: () => Promise<{ error: AuthError | null }>
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>
  loading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Escuta mudanças de auth em tempo real (login, logout, refresh de token)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      // PROIBIDO async/await aqui dentro — estritamente síncrono conforme instrução de integração
      setSession(newSession)
      setUser(newSession?.user ?? null)
      setLoading(false)
    })

    // Checagem inicial da sessão atual
    supabase.auth
      .getSession()
      .then(({ data: { session: initialSession }, error }) => {
        if (!error && initialSession) {
          setSession(initialSession)
          setUser(initialSession.user ?? null)
        } else {
          setSession(null)
          setUser(null)
        }
      })
      .catch(() => {
        setSession(null)
        setUser(null)
      })
      .finally(() => {
        setLoading(false)
      })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    return { error }
  }

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/`,
    })
    return { error }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        signIn,
        signOut,
        resetPassword,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
