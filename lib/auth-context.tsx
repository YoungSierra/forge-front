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
      localStorage.removeItem(MEMBER_ID_KEY)
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
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      loadMember(user).finally(() => setLoading(false))
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const u = session?.user ?? null
        setUser(u)
        loadMember(u)
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  // Idle timeout — fuerza logout tras 1 hora de inactividad
  useEffect(() => {
    if (!user) return

    const refresh = () => { lastActivityRef.current = Date.now() }
    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, refresh, { passive: true }))

    const timer = setInterval(async () => {
      if (Date.now() - lastActivityRef.current > IDLE_TIMEOUT) {
        await supabase.auth.signOut()
        window.location.replace('/login')
      }
    }, CHECK_INTERVAL)

    return () => {
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, refresh))
      clearInterval(timer)
    }
  }, [user])

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, member, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
