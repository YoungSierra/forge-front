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

    const dest = type === 'recovery' ? '/login?recovery=1' : '/'

    if (!code) { router.replace('/login'); return }

    supabase.auth.exchangeCodeForSession(code).then(async ({ error }) => {
      if (error) {
        // detectSessionInUrl puede haber consumido el code antes que nosotros —
        // si ya hay sesión activa, igual redirigimos al destino correcto
        const { data: { session } } = await supabase.auth.getSession()
        router.replace(session ? dest : '/login')
        return
      }
      router.replace(dest)
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
