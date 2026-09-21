'use client'

// ─── Despertar el backend mientras el usuario escribe ────────────────────────
//
// Render duerme el servicio por inactividad, y el primer request paga el arranque entero —medido
// en el orden de los 50 segundos—. Quien entra a Forge se lo come completo: entra, escribe su
// clave, y lo primero que pide la aplicación se queda colgado sin explicación.
//
// El login NO pasa por el backend: se autentica contra Supabase. O sea que mientras alguien mira
// la pantalla de login, Render sigue dormido y nadie lo está despertando. Ese es el hueco.
//
// Se aprovecha ese rato: al ABRIR el login —no al enviarlo— se dispara una petición a `/api/health`
// y no se espera respuesta. Entre que la persona escribe su correo, su contraseña y pulsa, Render
// ya lleva treinta segundos levantándose. Dispararlo en el submit no serviría: la espera sería la
// misma, solo que después.
//
// `/api/health` es instantáneo y no toca la base a propósito: lo que se quiere es que el proceso
// arranque, no medir Supabase. Pedir algo pesado alargaría el arranque en vez de acortarlo.

import { BACKEND_URL } from './api'

export type EstadoDelBackend = 'sin_pedir' | 'despertando' | 'despierto' | 'no_responde'

let estado: EstadoDelBackend = 'sin_pedir'
let enCurso: Promise<EstadoDelBackend> | null = null
const oyentes = new Set<(e: EstadoDelBackend) => void>()

function anunciar(e: EstadoDelBackend) {
  estado = e
  for (const f of oyentes) f(e)
}

/** Arranque frío de Render medido en el orden de los 50 s; se da margen antes de rendirse. */
const ESPERA_MS = 75_000

/**
 * Pide al backend que se levante. No se espera: se llama y se sigue.
 *
 * Se deduplica a propósito. Montar el login, volver atrás y entrar de nuevo dispararía tres
 * arranques, y el segundo no acelera nada — solo mete ruido en los logs de Render.
 */
/**
 * ¿Hay algo que despertar?
 *
 * En local no. `npm run dev` levanta el backend en `localhost:8000` y ahí no hay nada dormido: o
 * está corriendo y contesta al instante, o no está corriendo y ningún request lo va a levantar.
 * Pedirlo igual no rompe nada pero sí enseñaría «Starting the server…» mientras se prueba en la
 * máquina propia, que es un cartel que miente.
 */
const hayQueDespertar = () =>
  !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(BACKEND_URL)

export function despertarBackend(): Promise<EstadoDelBackend> {
  if (estado === 'despierto') return Promise.resolve(estado)
  if (!hayQueDespertar()) return Promise.resolve(estado)   // en local no se toca nada
  if (enCurso) return enCurso

  anunciar('despertando')
  const t0 = Date.now()

  enCurso = (async () => {
    // Dos intentos: el primero es el que paga el arranque y a veces lo corta el proxy de Render
    // antes de que el proceso esté escuchando. El segundo suele entrar ya caliente.
    for (let intento = 1; intento <= 2; intento++) {
      try {
        const r = await fetch(`${BACKEND_URL}/api/health`, {
          // `no-store` para que ni el navegador ni un proxy contesten con una respuesta vieja:
          // una caché diría «despierto» sin haber tocado Render, que es justo lo contrario.
          cache: 'no-store',
          signal: AbortSignal.timeout(ESPERA_MS),
        })
        if (r.ok) {
          console.log(`[despertar] backend listo en ${((Date.now() - t0) / 1000).toFixed(1)} s`)
          anunciar('despierto')
          despertarLaboratorio()
          return estado
        }
      } catch {
        // Silencio a propósito: esto corre de fondo y su fallo no es del usuario. Si el backend
        // no está, quien pida algo de verdad después ya recibirá su error con contexto.
      }
    }
    anunciar('no_responde')
    // Se suelta el candado: si el usuario se queda en la pantalla, un gesto suyo puede reintentar.
    enCurso = null
    return estado
  })()

  return enCurso
}

/**
 * Y de paso, el Laboratory.
 *
 * Es un TERCER servicio que también se duerme —el suyo tarda ~22 s en arrancar— y hasta ahora solo
 * despertaba cuando alguien abría un proyecto, que es justo cuando ya está esperando. Se despierta
 * desde el login por la misma razón que Render.
 *
 * Va DESPUÉS y no en paralelo: quien despierta al Laboratory es el backend, así que pedirlo antes
 * de que el backend esté en pie sería una petición que nadie atiende. Y no se espera su respuesta:
 * el endpoint contesta al instante y el arranque corre del otro lado.
 */
function despertarLaboratorio() {
  fetch(`${BACKEND_URL}/api/health/lab`, { cache: 'no-store' })
    .then(() => console.log('[despertar] laboratorio avisado'))
    .catch(() => { /* silencio: es de fondo y su fallo no es de quien está entrando */ })
}

/** El estado de ahora, para pintar sin suscribirse. */
export function estadoDelBackend(): EstadoDelBackend {
  return estado
}

/** Avisar cuando cambie. Devuelve la función para dejar de escuchar. */
export function alCambiarElBackend(f: (e: EstadoDelBackend) => void): () => void {
  oyentes.add(f)
  return () => { oyentes.delete(f) }
}
