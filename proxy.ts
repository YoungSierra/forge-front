import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Rutas estáticas y de auth: pasar sin ningún procesamiento de sesión.
  // getUser() en /auth/* interfiere con el PKCE code verifier almacenado en cookies.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/api') ||
    pathname.includes('.')
  ) {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // `getUser()` va a `/auth/v1` de Supabase en CADA navegación. Medido el 27-08 desde la red del
  // estudio: el REST responde 4/4 en ~250 ms y el de auth se cuelga 2 de 4. Cuando se cuelga, esta
  // llamada no vuelve y la página NUNCA renderiza — la app entera queda pegada por una red
  // intermitente.
  //
  // Con presupuesto: si no contesta a tiempo se deja pasar la navegación. No abre ningún agujero
  // — sin sesión válida el backend rechaza cada petición por su cuenta, y el cliente vuelve a
  // resolver la sesión al montar. Lo único que cambia es que una red lenta ya no cuelga la app.
  const PRESUPUESTO_MS = 2500
  let user = null
  let authTimeout = false
  try {
    const r = await Promise.race([
      supabase.auth.getUser(),
      new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('auth-timeout')), PRESUPUESTO_MS)),
    ]) as Awaited<ReturnType<typeof supabase.auth.getUser>>
    user = r.data.user
  } catch (e) {
    authTimeout = (e as Error)?.message === 'auth-timeout'
    if (authTimeout) console.warn(`[proxy] auth no respondió en ${PRESUPUESTO_MS} ms — se deja pasar ${pathname}`)
  }

  // Sin respuesta de auth no se puede afirmar que NO haya sesión, así que no se redirige a nadie:
  // mandar al login a quien sí está logueado por un timeout es peor que dejarlo entrar.
  if (authTimeout) return supabaseResponse

  const isLoginPage    = request.nextUrl.pathname === '/login'
  const isWelcomePage  = request.nextUrl.pathname === '/welcome'
  const isRecoveryFlow = isLoginPage && request.nextUrl.searchParams.get('recovery') === '1'
  const isPublicPath   = request.nextUrl.pathname.startsWith('/_next') ||
                         request.nextUrl.pathname.startsWith('/api') ||
                         request.nextUrl.pathname.startsWith('/auth/') ||
                         request.nextUrl.pathname.includes('.')

  // Sin sesión: aterrizar en la página de bienvenida (pública), no en el login de una.
  // Desde /welcome el botón "Sign in" lleva a /login.
  if (!user && !isLoginPage && !isWelcomePage && !isPublicPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/welcome'
    return NextResponse.redirect(url)
  }

  // No redirigir al home si el usuario viene del flujo de recovery
  if (user && isLoginPage && !isRecoveryFlow) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
