import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useCallback,
  useRef,
} from 'react'
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

  // Refs de controle para isolamento de requisições concorrentes e deduplicação
  const currentUserIdRef = useRef<string | null>(null)
  const activeRequestIdRef = useRef<number>(0)
  const inFlightPromiseRef = useRef<Promise<CoreAccessResolution> | null>(null)
  const accessStatusRef = useRef<AccessStatus | null>(null)

  const setAccessStatusState = useCallback((status: AccessStatus | null) => {
    accessStatusRef.current = status
    setAccessStatus(status)
  }, [])

  const clearAccessState = useCallback(() => {
    setLoadingAccess(false)
    setHasSystemAccess(false)
    setCorePerfil(null)
    setCorePerfilNome(null)
    setAccessStatusState(null)
    setCoreUserId(null)
    setCoreUsuarioNome(null)
    setCoreErrorMessage(null)
  }, [setAccessStatusState])

  /**
   * Executa a resolução assíncrona de autorização central protegida por:
   * - Identificador do usuário pretendido (`targetUserId`)
   * - Número de requisição incremental (`requestId`)
   * - Deduplicação de requisições em voo (inFlightPromiseRef)
   */
  const resolveAccessForUser = useCallback(
    async (targetUserId: string, force = false): Promise<CoreAccessResolution | null> => {
      // Se não for forçado e já houver consulta em andamento para este usuário, reutiliza a promessa
      if (!force && inFlightPromiseRef.current && currentUserIdRef.current === targetUserId) {
        return inFlightPromiseRef.current
      }

      const requestId = ++activeRequestIdRef.current

      const resolutionPromise = (async () => {
        try {
          const resolution = await resolveUserCoreAccess(targetUserId)

          // Só aplica se esta requisição ainda for a mais recente E o usuário ainda for o mesmo
          if (
            requestId === activeRequestIdRef.current &&
            currentUserIdRef.current === targetUserId
          ) {
            setHasSystemAccess(resolution.hasSystemAccess)
            setAccessStatusState(resolution.accessStatus)
            setCorePerfil(resolution.perfil)
            setCorePerfilNome(resolution.perfilNome ?? null)
            setCoreUserId(resolution.coreUserId)
            setCoreUsuarioNome(resolution.usuarioNome ?? null)
            setCoreErrorMessage(resolution.errorMessage ?? null)
            setLoadingAccess(false)
          }

          return resolution
        } catch (err: any) {
          if (
            requestId === activeRequestIdRef.current &&
            currentUserIdRef.current === targetUserId
          ) {
            console.error('[AuthProvider] Erro inesperado ao checar acesso central:', err)
            setHasSystemAccess(false)
            setAccessStatusState('error')
            setCorePerfil(null)
            setCorePerfilNome(null)
            setCoreUserId(null)
            setCoreUsuarioNome(null)
            setCoreErrorMessage(err?.message || 'Falha na checagem de autorização central.')
            setLoadingAccess(false)
          }

          const fallbackResolution: CoreAccessResolution = {
            hasSystemAccess: false,
            accessStatus: 'error',
            perfil: null,
            coreUserId: null,
            errorMessage: err?.message || 'Falha na checagem de autorização central.',
            isTechnicalError: true,
          }
          return fallbackResolution
        } finally {
          if (inFlightPromiseRef.current === resolutionPromise) {
            inFlightPromiseRef.current = null
          }
        }
      })()

      inFlightPromiseRef.current = resolutionPromise
      return resolutionPromise
    },
    [],
  )

  // Controle de versão sequencial para eventos de autenticação
  const authEventSeqRef = useRef<number>(0)
  // Flag que indica se onAuthStateChange já recebeu pelo menos um evento
  const onAuthEventReceivedRef = useRef<boolean>(false)

  /**
   * Ponto centralizado para aplicar uma nova sessão (ou nula) e disparar a autorização.
   * Chamado de forma síncrona tanto por onAuthStateChange quanto pela checagem inicial de getSession().
   * Protegido por sequência de versão para impedir que respostas tardias de getSession()
   * sobrescrevam eventos mais recentes de autenticação ou logout.
   */
  const applySessionAndAuthorize = useCallback(
    (newSession: Session | null, source: string, authSeq: number, event?: string) => {
      // Ignora respostas obsoletas de autenticação (ex.: getSession tardio após onAuthStateChange)
      if (authSeq < authEventSeqRef.current) {
        return
      }

      const newUserId = newSession?.user?.id ?? null
      const previousUserId = currentUserIdRef.current
      const isUserSwitch = newUserId !== previousUserId
      // Se for um novo evento SIGNED_IN do mesmo usuário, permite revalidar se o acesso estava bloqueado ('no_access' ou 'error')
      const isRevalidatableSignIn =
        !isUserSwitch &&
        event === 'SIGNED_IN' &&
        (accessStatusRef.current === 'no_access' || accessStatusRef.current === 'error')

      // Atualiza ref do usuário ativo imediatamente
      currentUserIdRef.current = newUserId

      // Atualiza estados síncronos de sessão
      setSession(newSession)
      setUser(newSession?.user ?? null)
      setLoading(false)

      if (!newUserId) {
        // Sessão encerrada ou ausente: invalida qualquer consulta pendente
        activeRequestIdRef.current++
        inFlightPromiseRef.current = null
        clearAccessState()
        return
      }

      if (isUserSwitch || isRevalidatableSignIn) {
        // Novo usuário, primeira restauração de sessão ou novo SIGNED_IN do mesmo usuário antes bloqueado:
        // 1. Invalida imediatamente qualquer autorização anterior
        // 2. Marca loadingAccess como true ANTES de liberar rotas
        setLoadingAccess(true)
        setHasSystemAccess(false)
        setCorePerfil(null)
        setCorePerfilNome(null)
        setAccessStatusState(null)
        setCoreUserId(null)
        setCoreUsuarioNome(null)
        setCoreErrorMessage(null)

        // Dispara resolução central (se for revalidação forçada de SIGNED_IN, force = true)
        void resolveAccessForUser(newUserId, isRevalidatableSignIn)
      } else {
        // Mesmo usuário (ex: TOKEN_REFRESHED, USER_UPDATED, getSession repetido).
        // Se for TOKEN_REFRESHED do mesmo usuário, NÃO dispara nova consulta de acesso.
        // Se ainda não houve resolução nem consulta em andamento, dispara a inicial.
        if (
          event !== 'TOKEN_REFRESHED' &&
          accessStatusRef.current === null &&
          !inFlightPromiseRef.current
        ) {
          setLoadingAccess(true)
          void resolveAccessForUser(newUserId, false)
        }
      }
    },
    [clearAccessState, resolveAccessForUser, setAccessStatusState],
  )

  const refreshAccess = useCallback(async () => {
    const activeUserId = currentUserIdRef.current
    if (!activeUserId) {
      clearAccessState()
      return null
    }
    // Revalidação explícita permitida mesmo para o mesmo usuário
    setLoadingAccess(true)
    return resolveAccessForUser(activeUserId, true)
  }, [clearAccessState, resolveAccessForUser])

  useEffect(() => {
    // Escuta mudanças de auth em tempo real (login, logout, refresh de token)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      // PROIBIDO async/await aqui dentro — estritamente síncrono conforme instrução de integração
      onAuthEventReceivedRef.current = true
      const currentSeq = ++authEventSeqRef.current
      applySessionAndAuthorize(newSession, 'onAuthStateChange', currentSeq, event)
    })

    // Checagem de segurança da sessão via getSession():
    // Uma resposta inicial tardia, nula, com erro ou pertencente a outro usuário JAMAIS pode
    // sobrescrever evento de autenticação mais recente ou restaurar sessão após logout.
    supabase.auth
      .getSession()
      .then(({ data: { session: initialSession }, error }) => {
        // Se onAuthStateChange já recebeu evento mais recente, ignora getSession tardio
        if (onAuthEventReceivedRef.current && authEventSeqRef.current > 0) {
          return
        }
        const currentSeq = ++authEventSeqRef.current
        if (!error && initialSession) {
          applySessionAndAuthorize(initialSession, 'getSession', currentSeq, 'INITIAL_SESSION')
        } else {
          applySessionAndAuthorize(null, 'getSession-error', currentSeq, 'INITIAL_SESSION')
        }
      })
      .catch((err) => {
        console.error('[AuthProvider] Erro ao obter sessão inicial:', err)
        if (onAuthEventReceivedRef.current && authEventSeqRef.current > 0) {
          return
        }
        const currentSeq = ++authEventSeqRef.current
        applySessionAndAuthorize(null, 'getSession-catch', currentSeq, 'INITIAL_SESSION')
      })

    return () => {
      subscription.unsubscribe()
    }
  }, [applySessionAndAuthorize])

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
