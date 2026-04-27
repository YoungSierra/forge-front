import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/lib/auth-context'
import FeedbackWidget from '@/components/feedback/FeedbackWidget'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'FORGE — AI Game Prototype Generator',
  description: 'Generate complete game prototypes with AI',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-[#0a0a0f] text-white antialiased">
          <AuthProvider>
            {children}
            <FeedbackWidget />
          </AuthProvider>
        </body>
    </html>
  )
}
