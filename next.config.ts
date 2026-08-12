import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  devIndicators: false,
  images: {
    // R2 público: next/image genera la miniatura, la sirve en AVIF/WebP y la cachea.
    // Sin esto la galería descarga el original (≈1 MB) para pintarlo del tamaño de una tarjeta.
    remotePatterns: [
      { hostname: 'localhost', port: '8000', protocol: 'http' },
      { hostname: 'pub-28f5c4eaef124db28ccd4d09ee853889.r2.dev', protocol: 'https' },
    ],
  },
  async headers() {
    return [
      {
        source: '/WebGL/Build/:path*.js.br',
        headers: [
          { key: 'Content-Encoding', value: 'br' },
          { key: 'Content-Type', value: 'application/javascript' },
        ],
      },
      {
        source: '/WebGL/Build/:path*.wasm.br',
        headers: [
          { key: 'Content-Encoding', value: 'br' },
          { key: 'Content-Type', value: 'application/wasm' },
        ],
      },
      {
        source: '/WebGL/Build/:path*.data.br',
        headers: [
          { key: 'Content-Encoding', value: 'br' },
          { key: 'Content-Type', value: 'application/octet-stream' },
        ],
      },
    ]
  },
}

export default nextConfig
