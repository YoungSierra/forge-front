import { NextRequest, NextResponse } from 'next/server'

// Proxy server-side para imágenes almacenadas en R2/storage.
// Evita restricciones CORS que impiden fetch() y canvas.toBlob() en el browser.
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'Missing url param' }, { status: 400 })

  let decoded: string
  try { decoded = decodeURIComponent(url) } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 })
  }

  // Se reenvía `Range` porque la miniatura de un .glb no baja el modelo: pide el chunk JSON
  // (64 KB) y después solo los bytes de las posiciones. Sin esto llegarían los 55 MB enteros.
  const range = req.headers.get('range')

  try {
    const upstream = await fetch(decoded, {
      redirect: 'follow',
      headers: range ? { Range: range } : undefined,
    })
    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json({ error: `Upstream ${upstream.status}` }, { status: 502 })
    }
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream'
    const headers: Record<string, string> = {
      'Content-Type':  contentType,
      'Cache-Control': 'public, max-age=3600',
    }
    // El 206 solo sirve si viaja con su rango: quien pidió los bytes necesita saber cuáles llegaron.
    const contentRange = upstream.headers.get('content-range')
    if (contentRange) headers['Content-Range'] = contentRange
    if (upstream.headers.get('accept-ranges')) headers['Accept-Ranges'] = 'bytes'

    return new NextResponse(upstream.body, { status: upstream.status, headers })
  } catch {
    return NextResponse.json({ error: 'Fetch failed' }, { status: 502 })
  }
}
