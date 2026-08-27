import { NextResponse, type NextRequest } from 'next/server'

// ─── ¿Hay sesión? — leída de la cookie, sin salir a la red ────────────────────
//
// Antes esto llamaba a `supabase.auth.getUser()` en CADA navegación, y eso es una petición a
// `/auth/v1` de Supabase por cada página que abrís. Medido el 27-08 en los logs del proyecto:
// **377 peticiones de auth en 60 minutos**, casi todas `GET /user`.
//
// El servidor de auth del plan FREE tiene **10 conexiones** y mata toda petición a los **10
// segundos** (Authentication -> Performance, y no se puede subir sin Pro). Con ese caudal el pool
// se queda sin conexiones, las peticiones se encolan y mueren en el límite — exactamente los
// timeouts de 10 s que medimos. No era Supabase caído: éramos nosotros ahogándolo.
//
// El middleware NO necesita validar la firma: solo decide a dónde mandarte. Si hay un token sin
// vencer, te deja seguir; si no, al welcome. **La validación de verdad la hace el backend en cada
// petición**, que verifica el JWT contra Supabase — un token falso no abre ningún dato.
function haySesion(request: NextRequest): boolean {
  // supabase-js guarda la sesión en `sb-<ref>-auth-token`, y si es grande la parte en `.0`, `.1`…
  const partes = request.cookies.getAll()
    .filter(c => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name))
  if (!partes.length) return false

  let bruto = partes.map(c => c.value).join('')
  try {
    if (bruto.startsWith('base64-')) bruto = atob(bruto.slice('base64-'.length))
  } catch { /* se sigue con lo que haya */ }

  const m = /"access_token"\s*:\s*"([^"]+)"/.exec(bruto)
  // Hay cookie pero no se pudo leer el token: se asume que hay sesión. Equivocarse hacia "entra"
  // solo cuesta que el backend lo rechace; equivocarse hacia "no entra" saca a alguien logueado.
  if (!m) return true

  const payload = m[1].split('.')[1]
  if (!payload) return true
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof json.exp !== 'number') return true
    return json.exp * 1000 > Date.now()
  } catch { return true }
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Rutas estáticas y de auth: pasar sin ningún procesamiento de sesión.
  // El flujo PKCE guarda su verifier en cookies y no hay que tocarlo.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/api') ||
    pathname.includes('.')
  ) {
    return NextResponse.next({ request })
  }

  const sesion = haySesion(request)

  const isLoginPage    = pathname === '/login'
  const isWelcomePage  = pathname === '/welcome'
  const isRecoveryFlow = isLoginPage && request.nextUrl.searchParams.get('recovery') === '1'

  // Sin sesión: aterrizar en la página de bienvenida (pública), no en el login de una.
  // Desde /welcome el botón "Sign in" lleva a /login.
  if (!sesion && !isLoginPage && !isWelcomePage) {
    const url = request.nextUrl.clone()
    url.pathname = '/welcome'
    return NextResponse.redirect(url)
  }

  // No redirigir al home si el usuario viene del flujo de recovery
  if (sesion && isLoginPage && !isRecoveryFlow) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return NextResponse.next({ request })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
