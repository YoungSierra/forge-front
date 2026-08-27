import { createBrowserClient } from '@supabase/ssr'

function construir() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // Sin `navigator.locks`.
        //
        // Por defecto supabase-js serializa cada operación de auth con un candado del navegador
        // COMPARTIDO ENTRE PESTAÑAS del mismo origen. Con varias pestañas de Forge abiertas y
        // varias llamadas en vuelo, unas le roban el candado a otras: «Lock was released because
        // another request stole it» / «Lock broken by another request with the 'steal' option»,
        // y la página se queda colgada esperando un candado que ya no existe.
        //
        // El candado solo protege contra dos pestañas refrescando el token a la vez. El costo de
        // esa carrera es un refresco de más; el costo de tenerlo era que la app no cargara.
        lock: <R>(_nombre: string, _esperaMs: number, fn: () => Promise<R>): Promise<R> => fn(),
      },
    },
  )
}

// Una sola instancia por pestaña. Crear un cliente nuevo en cada componente multiplica los
// suscriptores de auth y, con ellos, el trabajo en cada cambio de sesión.
let _cliente: ReturnType<typeof construir> | null = null

export function createClient() {
  if (!_cliente) _cliente = construir()
  return _cliente
}
