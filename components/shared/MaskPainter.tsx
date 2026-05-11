'use client'

import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react'

export interface MaskPainterHandle {
  getComposedBlob: () => Promise<Blob | null>
  clear: () => void
  hasStrokes: () => boolean
}

interface Props {
  imageFile: File
  brushSize: number
}

const MaskPainter = forwardRef<MaskPainterHandle, Props>(({ imageFile, brushSize }, ref) => {
  const imgCanvasRef  = useRef<HTMLCanvasElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)
  const paintingRef   = useRef(false)
  const hasStrokesRef = useRef(false)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)

  useImperativeHandle(ref, () => ({
    async getComposedBlob() {
      const imgCanvas  = imgCanvasRef.current
      const maskCanvas = maskCanvasRef.current
      if (!imgCanvas || !maskCanvas) return null

      const w = imgCanvas.width
      const h = imgCanvas.height

      const out = document.createElement('canvas')
      out.width  = w
      out.height = h
      const ctx  = out.getContext('2d')!
      ctx.drawImage(imgCanvas, 0, 0)

      const imgData  = ctx.getImageData(0, 0, w, h)
      const maskData = maskCanvas.getContext('2d')!.getImageData(0, 0, w, h)

      // Máscara binaria limpia: zona pintada → transparente (ComfyUI edita),
      // zona sin pintar → opaco (ComfyUI preserva)
      for (let i = 0; i < imgData.data.length; i += 4) {
        imgData.data[i + 3] = maskData.data[i + 3] > 10 ? 0 : 255
      }
      ctx.putImageData(imgData, 0, 0)

      return new Promise<Blob | null>(resolve => out.toBlob(resolve, 'image/png'))
    },
    clear() {
      const canvas = maskCanvasRef.current
      if (!canvas || !dims) return
      canvas.getContext('2d')!.clearRect(0, 0, dims.w, dims.h)
      hasStrokesRef.current = false
    },
    hasStrokes: () => hasStrokesRef.current,
  }))

  useEffect(() => {
    const url = URL.createObjectURL(imageFile)
    const img = new Image()
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img
      setDims({ w, h })
      const imgCanvas  = imgCanvasRef.current
      const maskCanvas = maskCanvasRef.current
      if (!imgCanvas || !maskCanvas) return
      imgCanvas.width  = maskCanvas.width  = w
      imgCanvas.height = maskCanvas.height = h
      imgCanvas.getContext('2d')!.drawImage(img, 0, 0)
      maskCanvas.getContext('2d')!.clearRect(0, 0, w, h)
      hasStrokesRef.current = false
    }
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  function getCoords(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = maskCanvasRef.current!
    const rect   = canvas.getBoundingClientRect()
    const sx     = canvas.width  / rect.width
    const sy     = canvas.height / rect.height
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy }
  }

  function paintAt(x: number, y: number) {
    const canvas = maskCanvasRef.current!
    const ctx    = canvas.getContext('2d')!
    const rect   = canvas.getBoundingClientRect()
    const scale  = canvas.width / rect.width
    ctx.fillStyle = 'rgba(255, 80, 0, 0.9)'
    ctx.beginPath()
    ctx.arc(x, y, brushSize * scale, 0, Math.PI * 2)
    ctx.fill()
    hasStrokesRef.current = true
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    paintingRef.current = true
    const { x, y } = getCoords(e)
    paintAt(x, y)
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!paintingRef.current) return
    const { x, y } = getCoords(e)
    paintAt(x, y)
  }

  return (
    <div style={{ position: 'relative', width: '100%', userSelect: 'none', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--line-2)' }}>
      {!dims && (
        <div style={{ padding: 24, textAlign: 'center', fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)' }}>
          Loading image…
        </div>
      )}
      <canvas
        ref={imgCanvasRef}
        style={{ display: 'block', width: '100%', height: 'auto' }}
      />
      <canvas
        ref={maskCanvasRef}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', cursor: 'crosshair' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={() => { paintingRef.current = false }}
        onMouseLeave={() => { paintingRef.current = false }}
      />
      {dims && (
        <div style={{
          position: 'absolute', bottom: 6, right: 6,
          fontSize: 9, fontFamily: 'monospace', color: 'rgba(255,255,255,0.6)',
          background: 'rgba(0,0,0,0.4)', padding: '2px 6px', borderRadius: 4,
          pointerEvents: 'none',
        }}>
          Paint the area to edit
        </div>
      )}
    </div>
  )
})

MaskPainter.displayName = 'MaskPainter'
export default MaskPainter
