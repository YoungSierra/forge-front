'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { getMemberByAuth } from '@/lib/api'
import type { User } from '@supabase/supabase-js'
import type { Member } from '@/lib/types'

const MEMBER_ID_KEY  = 'forge_member_id'
const IDLE_TIMEOUT   = 60 * 60 * 1000  // 1 hora en ms
const CHECK_INTERVAL = 60 * 1000       // revisar cada minuto
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'] as const

interface AuthContextType {
  user: User | null
  member: Member | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  member: null,
  loading: true,
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]       = useState<User | null>(null)
  const [member, setMember]   = useState<Member | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase              = createClient()
  const lastActivityRef       = useRef<number>(Date.now())

  async function loadMember(authUser: User | null) {
    if (!authUser) {
      setMember(null)
      // Limpiar TODO lo del usuario en localStorage al cerrar sesión / expirar — si no, queda basura
      // (ej. el breadcrumb "último proyecto") que se cruza al loguearse otro usuario en el mismo navegador.
      localStorage.removeItem(MEMBER_ID_KEY)
      localStorage.removeItem('forge_last_project')
      localStorage.removeItem('forge_active_org_id')
      return
    }
    try {
      const m = await getMemberByAuth(authUser.id)
      setMember(m)
      if (m?.id) localStorage.setItem(MEMBER_ID_KEY, m.id)
    } catch {
      setMember(null)
    }
  }

  useEffect(() => {
    // La suscripción es la fuente: al suscribirse dispara `INITIAL_SESSION` con la sesión que ya
    // hay guardada, sin red y sin pedir el candado del navegador.
    //
    // Antes esto arrancaba con `getUser()`, que va a la red Y toma `navigator.locks` — el mismo
    // candado que pedía cada llamada de la API. Con varias pestañas abiertas o varias peticiones
    // en paralelo se pisaban y una le robaba el candado a otra: «Lock was released because
    // another request stole it» y la página no cargaba.
    let vivo = true
    let respondio = false
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!vivo) return
        respondio = true
        const u = session?.user ?? null
        setUser(u)
        loadMember(u)
        setLoading(false)
      }
    )

    // Red de seguridad: si `INITIAL_SESSION` no llegara, la app quedaría girando para siempre.
    // Se resuelve leyendo la sesión guardada una sola vez.
    const respaldo = setTimeout(() => {
      if (!vivo || respondio) return
      supabase.auth.getSession()
        .then(({ data }) => {
          if (!vivo) return
          const u = data.session?.user ?? null
          setUser(u)
          return loadMember(u)
        })
        .catch(() => {})
        .finally(() => { if (vivo) setLoading(false) })
    }, 3000)

    return () => { vivo = false; clearTimeout(respaldo); subscription.unsubscribe() }
  }, [])

  // Idle timeout — fuerza logout tras 1 hora de inactividad
  useEffect(() => {
    if (!user) return

    const refresh = () => { lastActivityRef.current = Date.now() }
    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, refresh, { passive: true }))

    const timer = setInterval(async () => {
      if (Date.now() - lastActivityRef.current > IDLE_TIMEOUT) {
        await supabase.auth.signOut()
        window.location.replace('/welcome')
      }
    }, CHECK_INTERVAL)

    return () => {
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, refresh))
      clearInterval(timer)
    }
  }, [user])

  function signOut() {
    localStorage.removeItem(MEMBER_ID_KEY)
    localStorage.removeItem('forge_last_project')
    localStorage.removeItem('forge_active_org_id')
    // Navegar de INMEDIATO: si esperáramos el signOut, React alcanza a renderizar el error de alguna
    // request que quedó sin token (el "Invalid token" del backend) y se ve un parpadeo rojo antes del
    // redirect. Revocamos la sesión en segundo plano y descargamos la página ya.
    supabase.auth.signOut().catch(() => {})
    window.location.replace('/welcome')
    return Promise.resolve()
  }

  return (
    <AuthContext.Provider value={{ user, member, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
