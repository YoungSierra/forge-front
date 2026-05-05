'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { getMemberByAuth } from '@/lib/api'
import type { User } from '@supabase/supabase-js'
import type { Member } from '@/lib/types'

const MEMBER_ID_KEY = 'forge_member_id'

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
  const [user, setUser]     = useState<User | null>(null)
  const [member, setMember] = useState<Member | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

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
