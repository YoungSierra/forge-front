'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

// Recibe el ?code= de Supabase (flujo PKCE), lo deja procesar al cliente,
// y redirige al login. onAuthStateChange en /login detecta PASSWORD_RECOVERY.
export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()

    // Listener primero, luego intercambiar — para no perder el evento
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') router.replace('/login?recovery=1')
      else if (event === 'SIGNED_IN') router.replace('/')
    })

    // PKCE: el verify de Supabase manda ?code= — hay que intercambiarlo explícitamente
    const code = new URLSearchParams(window.location.search).get('code')
    if (code) {
      supabase.auth.exchangeCodeForSession(code).catch(() => router.replace('/login'))
    }

    return () => subscription.unsubscribe()
  }, [router])

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#0a0a0c',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-mono)', fontSize: 12, color: '#50505e',
    }}>
      Verifying…
    </div>
  )
}
