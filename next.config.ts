import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { hostname: 'localhost', port: '8000', protocol: 'http' },
    ],
  },
}

export default nextConfig
