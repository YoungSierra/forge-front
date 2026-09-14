'use client'

// Botón que lanza el Prototype Laboratory con el TDD de ESTE proyecto ya puesto.
//
// Va apilado sobre Forgy y no se arrastra: el moodboard es donde uno vive, y esto es una salida
// hacia otra herramienta. Dos botones arrastrables encima del canvas terminan uno debajo del otro.
//
// Solo aparece si hay a dónde ir. Sin `LAB_URL` configurada, o sin TDD ensamblado en el proyecto,
// no se dibuja: un botón que solo sabe dar error no es mejor que ningún botón.

import { useEffect, useState } from 'react'
import { getLaboratorio, abrirLaboratorio } from '@/lib/api'

const SIZE = 44

interface Props {
  projectId: string
  /** A qué altura del borde inferior, para quedar justo encima de Forgy. */
  bottom?: number
}

export default function LaboratoryButton({ projectId, bottom = 92 }: Props) {
  const [hay,   setHay]   = useState(false)
  const [doc,   setDoc]   = useState<string | null>(null)
  const [yendo, setYendo] = useState(false)
  const [hover, setHover] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    getLaboratorio(projectId)
      .then(r => { if (vivo) { setHay(r.configurado && r.tiene_tdd); setDoc(r.documento ?? null) } })
      .catch(() => { if (vivo) setHay(false) })
    return () => { vivo = false }
  }, [projectId])

  if (!hay) return null

  async function ir() {
    setError(null)
    setYendo(true)
    // La pestaña se abre ANTES de la llamada: abrirla después la mata el bloqueador de ventanas
    // emergentes, porque para entonces ya no hay un gesto del usuario de por medio.
    const pestana = window.open('', '_blank')
    try {
      const r = await abrirLaboratorio(projectId)
      if (!r.usable) {
        // El Laboratory construye a partir de las mecánicas del TDD. Sin ninguna abre una pantalla
        // vacía, y es mejor decirlo que dejar que lo descubra allá.
        const seguir = window.confirm(
          `The Laboratory could not read a single mechanic from “${r.documento}”.\n\n` +
          'It builds from the mechanics the TDD declares, so it will open with nothing to work ' +
          'from. Open it anyway?')
        if (!seguir) { pestana?.close(); setYendo(false); return }
      }
      if (pestana) pestana.location.href = r.url
      else window.open(r.url, '_blank')
    } catch (e) {
      pestana?.close()
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setYendo(false)
    }
  }

  return (
    <div style={{ position: 'fixed', right: 22, bottom, zIndex: 11000 }}>
      {error && (
        <div style={{
          position: 'absolute', right: SIZE + 10, bottom: 0, width: 260, padding: '8px 10px',
          borderRadius: 8, background: 'rgba(10,12,16,0.96)', border: '1px solid #8d3b3b',
          color: 'var(--text-1, #c7cedb)', fontSize: 11.5, lineHeight: 1.5,
        }}>{error}</div>
      )}
      <button
        onClick={ir}
        disabled={yendo}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title={doc ? `Prototype Laboratory — opens with “${doc}”` : 'Prototype Laboratory'}
        style={{
          width: SIZE, height: SIZE, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: yendo ? 'wait' : 'pointer',
          background: hover ? 'rgba(28,34,42,0.98)' : 'rgba(18,22,28,0.94)',
          border: '1px solid rgba(255,255,255,0.18)',
          boxShadow: hover ? '0 10px 28px rgba(0,0,0,0.6)' : '0 6px 18px rgba(0,0,0,0.45)',
          transition: 'background 160ms ease, box-shadow 160ms ease',
          opacity: yendo ? 0.6 : 1,
        }}
      >
        {/* Un mando: lo que sale de allá es algo que se juega. */}
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#e8eef7' }}>
          <path d="M6 11h4" /><path d="M8 9v4" /><path d="M15 12h.01" /><path d="M18 10h.01" />
          <rect x="2" y="6" width="20" height="12" rx="5" />
        </svg>
      </button>
    </div>
  )
}
