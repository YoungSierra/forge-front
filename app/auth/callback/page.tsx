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
    const params   = new URLSearchParams(window.location.search)
    const code     = params.get('code')
    const type     = params.get('type')

    if (!code) { router.replace('/login'); return }

    // PKCE: intercambiar el code y redirigir según el tipo de flujo
    supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) { router.replace('/login'); return }
      if (type === 'recovery') router.replace('/login?recovery=1')
      else router.replace('/')
    })
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
