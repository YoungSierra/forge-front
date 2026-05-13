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

  try {
    const upstream = await fetch(decoded)
    if (!upstream.ok) {
      return NextResponse.json({ error: `Upstream ${upstream.status}` }, { status: 502 })
    }
    const buffer      = await upstream.arrayBuffer()
    const contentType = upstream.headers.get('content-type') || 'image/png'
    return new NextResponse(buffer, {
      headers: {
        'Content-Type':  contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Fetch failed' }, { status: 502 })
  }
}
