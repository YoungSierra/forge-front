'use client'
import { useEffect, useRef, useState } from 'react'

interface Props {
  active: boolean
  color?: string
}

export function FakeProgressBar({ active, color = 'var(--cat-asset)' }: Props) {
  const [show, setShow]   = useState(false)
  const [done, setDone]   = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (active) {
      clearTimeout(timer.current)
      setDone(false)
      setShow(true)
    } else if (show) {
      setDone(true)
      timer.current = setTimeout(() => { setShow(false); setDone(false) }, 550)
    }
    return () => clearTimeout(timer.current)
  }, [active])

  if (!show) return null

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, height: 3,
      background: 'rgba(255,255,255,0.07)', zIndex: 20,
      borderRadius: 'inherit',
      overflow: 'hidden',
      pointerEvents: 'none',
    }}>
      <div style={{
        height: '100%',
        background: color,
        borderRadius: '0 2px 2px 0',
        ...(done
          ? { width: '100%', transition: 'width 0.3s ease' }
          : { animation: 'fp-run 45s cubic-bezier(0.08, 0.05, 0.25, 1) forwards' }
        ),
      }} />
      <style>{`
        @keyframes fp-run {
          0%   { width: 0% }
          20%  { width: 45% }
          50%  { width: 68% }
          75%  { width: 80% }
          100% { width: 88% }
        }
      `}</style>
    </div>
  )
}
