'use client'

// ─── La esfera del ángulo de cámara ──────────────────────────────────────────
//
// Informe v8, punto 8. «New Angle» pide tres números —azimut, elevación y distancia— y hasta ahora
// eran tres barras sueltas: nadie sabe qué encuadre sale de «45 · 45 · 8» hasta que lo paga. Y
// cada corrida es pago y no se reproduce, así que entender el ángulo ANTES es la diferencia entre
// ejecutar y apostar.
//
// Los tres controles son en realidad UN punto en el espacio, que es lo que pide el informe: «un
// visualizador en forma de esfera que una los 3 puntos seleccionados». Acá se dibuja ese punto
// sobre la esfera que rodea al asset, con su rayo de visión hasta el centro.
//
// Es SVG a mano y sin biblioteca: son cuatro senos y un coseno, y meter un motor 3D para esto
// costaría más de descarga que toda la ventana.

/** Proyección: se mira la escena desde un poco por encima, para que el ecuador se lea como elipse
 *  y no como una raya. 20° es lo que separa «esfera» de «círculo» sin deformar los polos. */
const INCL = (20 * Math.PI) / 180
const SIN_I = Math.sin(INCL)
const COS_I = Math.cos(INCL)

/**
 * Un punto de la esfera a coordenadas de pantalla.
 *
 * `azimut` 0° es de frente al asset y crece hacia la derecha; `elevacion` positiva es por encima.
 * `radio` en unidades de la esfera: 1 = sobre la superficie, >1 = más lejos.
 *
 * Devuelve además `prof`, de -1 a 1: cuánto está el punto del lado de acá de la esfera. Se usa para
 * desvanecer lo que queda detrás, que es cómo se lee que la cámara está por atrás del asset.
 *
 * Es un número y no un sí/no a propósito: un perfil derecho picado cae a -0,17 —justo del otro
 * lado del plano de visión por unos grados— y con un corte booleano se apagaba del todo, como si
 * estuviera detrás del asset. Con la rampa apenas se atenúa, y una vista trasera de verdad sí.
 */
function aPantalla(azimut: number, elevacion: number, radio: number, cx: number, cy: number, R: number) {
  const a = (azimut * Math.PI) / 180
  const e = (elevacion * Math.PI) / 180
  const x = Math.sin(a) * Math.cos(e)
  const y = Math.sin(e)
  const z = Math.cos(a) * Math.cos(e)
  // Giro de la escena sobre el eje horizontal de la pantalla: lo que viene hacia el espectador
  // BAJA y lo que se aleja sube, que es como se mira algo desde un poco por encima. Con los signos
  // al revés «Front» salía dibujado por encima del asset y la esfera se leía del revés.
  const sy   = y * COS_I - z * SIN_I
  const prof = y * SIN_I + z * COS_I
  return {
    x: cx + R * radio * x,
    y: cy - R * radio * sy,
    prof,
  }
}

/** De la profundidad a la opacidad: delante se ve entero, detrás se insinúa. */
const velo = (prof: number) => 0.35 + 0.65 * Math.max(0, Math.min(1, (prof + 1) / 2))

export default function VisorDeAngulo({
  azimut, elevacion, zoom, accent,
}: {
  azimut: number
  elevacion: number
  /** 0 = plano general, 10 = primer plano. Es la escala del propio workflow. */
  zoom: number
  accent: string
}) {
  const W = 240, H = 170
  const cx = W / 2, cy = H / 2 + 6
  const R = 52

  // La distancia de la cámara al asset. El workflow llama «zoom» a lo contrario de lo que suele
  // llamarse así: 0 es lejos y 10 es encima. Se invierte para que acercar el control acerque
  // la cámara en el dibujo.
  const radio = 2.05 - (Math.max(0, Math.min(10, zoom)) / 10) * 0.95
  const cam = aPantalla(azimut, elevacion, radio, cx, cy, R)
  const sup = aPantalla(azimut, elevacion, 1, cx, cy, R)

  // El ecuador y el meridiano que pasa por la cámara: dan el suelo y la altura de un vistazo.
  const ecuadorRy = Math.max(3, R * SIN_I)

  // El meridiano de la cámara, muestreado. Una elipse no sirve acá porque su inclinación depende
  // del azimut; veinticuatro puntos salen más baratos que la matemática de la elipse girada.
  const meridiano = Array.from({ length: 49 }, (_, i) => {
    const p = aPantalla(azimut, -180 + i * 7.5, 1, cx, cy, R)
    return `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`
  }).join(' ')

  const tenue = velo(cam.prof)

  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
        {/* La esfera. Es el volumen que rodea al asset, no un planeta: va casi sin peso. */}
        <circle cx={cx} cy={cy} r={R} fill="rgba(255,255,255,0.025)" stroke="var(--line-2, #232830)" strokeWidth={1} />
        <ellipse cx={cx} cy={cy} rx={R} ry={ecuadorRy} fill="none" stroke="var(--line-2, #232830)" strokeWidth={1} />
        <path d={meridiano} fill="none" stroke="var(--line-2, #232830)" strokeWidth={0.75} strokeDasharray="2 3" opacity={0.85} />

        {/* El asset, en el centro. Una caja en perspectiva dice «una pieza» mejor que un punto. */}
        <g opacity={0.9}>
          <rect x={cx - 9} y={cy - 11} width={18} height={18} rx={2}
                fill="rgba(255,255,255,0.10)" stroke="var(--text-3, #6b7280)" strokeWidth={1} />
          <path d={`M${cx - 9} ${cy - 11} L${cx - 4} ${cy - 16} L${cx + 14} ${cy - 16} L${cx + 9} ${cy - 11} Z`}
                fill="rgba(255,255,255,0.05)" stroke="var(--text-3, #6b7280)" strokeWidth={1} />
          <path d={`M${cx + 9} ${cy - 11} L${cx + 14} ${cy - 16} L${cx + 14} ${cy + 2} L${cx + 9} ${cy + 7} Z`}
                fill="rgba(255,255,255,0.03)" stroke="var(--text-3, #6b7280)" strokeWidth={1} />
        </g>

        {/* El rayo de visión: de la cámara al asset. Es lo que «une los 3 puntos» —el azimut y la
            elevación dicen por dónde entra, la distancia dónde empieza—. */}
        <line x1={cam.x} y1={cam.y} x2={cx} y2={cy}
              stroke={accent} strokeWidth={1} strokeDasharray="3 3" opacity={0.5 * tenue} />
        {/* Dónde atraviesa la esfera: ata el punto de la cámara a la superficie. */}
        <circle cx={sup.x} cy={sup.y} r={2.5} fill={accent} opacity={0.45 * tenue} />

        {/* La cámara. El triángulo apunta al asset, así que se gira según por dónde mira. */}
        <g transform={`translate(${cam.x} ${cam.y}) rotate(${(Math.atan2(cy - cam.y, cx - cam.x) * 180) / Math.PI})`}
           opacity={tenue}>
          <path d="M0 0 L14 -7 L14 7 Z" fill={accent} opacity={0.22} />
          <circle cx={0} cy={0} r={4.5} fill={accent} stroke="var(--bg-1, #0e1116)" strokeWidth={1.5} />
        </g>

        {/* Las cuatro marcas del plano, para leer el azimut sin contar grados. */}
        {[
          { a: 0,   t: 'FRONT' },
          { a: 90,  t: 'RIGHT' },
          { a: 180, t: 'BACK' },
          { a: 270, t: 'LEFT' },
        ].map(m => {
          const p = aPantalla(m.a, 0, 1.28, cx, cy, R)
          return (
            <text key={m.t} x={p.x} y={p.y + 3} textAnchor="middle"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 7, letterSpacing: '.08em' }}
                  fill="var(--text-3, #6b7280)" opacity={velo(p.prof) * 0.9}>
              {m.t}
            </text>
          )
        })}
      </svg>
    </div>
  )
}
