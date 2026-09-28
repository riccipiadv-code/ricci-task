import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react'
import { User, Session, AuthError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'
import {
  resolveUserCoreAccess,
  CorePerfilCodigo,
  AccessStatus,
  CoreAccessResolution,
} from '@/services/core-access'

interface AuthContextType {
  user: User | null
  session: Session | null
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>
  signOut: () => Promise<{ error: AuthError | null }>
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>
  loading: boolean

  // Autorização central via Gestor de Acessos Ricci (Etapa 1)
  loadingAccess: boolean
  hasSystemAccess: boolean
  corePerfil: CorePerfilCodigo | null
  corePerfilNome: string | null
  accessStatus: AccessStatus | null
  coreUserId: string | null
  coreUsuarioNome: string | null
  coreErrorMessage: string | null
  refreshAccess: () => Promise<CoreAccessResolution | null>
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

  // Estados de autorização central (Gestor de Acessos Ricci)
  const [loadingAccess, setLoadingAccess] = useState(false)
  const [hasSystemAccess, setHasSystemAccess] = useState(false)
  const [corePerfil, setCorePerfil] = useState<CorePerfilCodigo | null>(null)
  const [corePerfilNome, setCorePerfilNome] = useState<string | null>(null)
  const [accessStatus, setAccessStatus] = useState<AccessStatus | null>(null)
  const [coreUserId, setCoreUserId] = useState<string | null>(null)
  const [coreUsuarioNome, setCoreUsuarioNome] = useState<string | null>(null)
  const [coreErrorMessage, setCoreErrorMessage] = useState<string | null>(null)

  const clearAccessState = useCallback(() => {
    setLoadingAccess(false)
    setHasSystemAccess(false)
    setCorePerfil(null)
    setCorePerfilNome(null)
    setAccessStatus(null)
    setCoreUserId(null)
    setCoreUsuarioNome(null)
    setCoreErrorMessage(null)
  }, [])

  const fetchAccess = useCallback(async (authUserId: string): Promise<CoreAccessResolution> => {
    setLoadingAccess(true)
    try {
      const resolution = await resolveUserCoreAccess(authUserId)
      setHasSystemAccess(resolution.hasSystemAccess)
      setAccessStatus(resolution.accessStatus)
      setCorePerfil(resolution.perfil)
      setCorePerfilNome(resolution.perfilNome ?? null)
      setCoreUserId(resolution.coreUserId)
      setCoreUsuarioNome(resolution.usuarioNome ?? null)
      setCoreErrorMessage(resolution.errorMessage ?? null)
      return resolution
    } finally {
      setLoadingAccess(false)
    }
  }, [])

  const refreshAccess = useCallback(async () => {
    if (!user?.id) {
      clearAccessState()
      return null
    }
    return fetchAccess(user.id)
  }, [user?.id, clearAccessState, fetchAccess])

  // Resolve autorização central sempre que o usuário autenticado mudar
  useEffect(() => {
    if (!user?.id) {
      clearAccessState()
      return
    }

    let isMounted = true
    setLoadingAccess(true)

    resolveUserCoreAccess(user.id)
      .then((resolution) => {
        if (!isMounted) return
        setHasSystemAccess(resolution.hasSystemAccess)
        setAccessStatus(resolution.accessStatus)
        setCorePerfil(resolution.perfil)
        setCorePerfilNome(resolution.perfilNome ?? null)
        setCoreUserId(resolution.coreUserId)
        setCoreUsuarioNome(resolution.usuarioNome ?? null)
        setCoreErrorMessage(resolution.errorMessage ?? null)
      })
      .catch((err) => {
        if (!isMounted) return
        console.error('[AuthProvider] Erro inesperado ao checar acesso central:', err)
        setHasSystemAccess(false)
        setAccessStatus('error')
        setCorePerfil(null)
        setCorePerfilNome(null)
        setCoreUserId(null)
        setCoreUsuarioNome(null)
        setCoreErrorMessage(err?.message || 'Falha na checagem de autorização central.')
      })
      .finally(() => {
        if (isMounted) {
          setLoadingAccess(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [user?.id, clearAccessState])

  useEffect(() => {
    // Escuta mudanças de auth em tempo real (login, logout, refresh de token)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      // PROIBIDO async/await aqui dentro — estritamente síncrono conforme instrução de integração
      // 1. ANTES de definir a nova sessão/usuário, executar setLoadingAccess(Boolean(newSession?.user))
      // e caso newSession seja nula, limpar o estado central imediatamente
      if (newSession?.user) {
        setLoadingAccess(true)
      } else {
        clearAccessState()
      }
      setSession(newSession)
      setUser(newSession?.user ?? null)
      setLoading(false)
    })

    // Checagem inicial da sessão atual
    supabase.auth
      .getSession()
      .then(({ data: { session: initialSession }, error }) => {
        if (!error && initialSession?.user) {
          // Se houver initialSession, setLoadingAccess(true) ANTES de setSession e setUser
          setLoadingAccess(true)
          setSession(initialSession)
          setUser(initialSession.user)
        } else {
          clearAccessState()
          setSession(null)
          setUser(null)
        }
      })
      .catch(() => {
        clearAccessState()
        setSession(null)
        setUser(null)
      })
      .finally(() => {
        setLoading(false)
      })

    return () => {
      subscription.unsubscribe()
    }
  }, [clearAccessState])

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
        loadingAccess,
        hasSystemAccess,
        corePerfil,
        corePerfilNome,
        accessStatus,
        coreUserId,
        coreUsuarioNome,
        coreErrorMessage,
        refreshAccess,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
