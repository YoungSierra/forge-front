import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  devIndicators: false,
  images: {
    remotePatterns: [
      { hostname: 'localhost', port: '8000', protocol: 'http' },
    ],
  },
}

export default nextConfig
