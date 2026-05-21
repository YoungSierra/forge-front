import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import { AuthProvider } from '@/lib/auth-context'
import FeedbackWidget from '@/components/feedback/FeedbackWidget'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Forge — AI Game Pipeline',
  description: 'Generate complete game prototypes with AI',
  icons: { icon: '/forgy/forgyi.png', apple: '/forgy/forgyi.png' },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('forge-theme');if(t==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}` }}
        />
      </head>
      <body className="min-h-screen bg-[#0e0f12] text-white antialiased">
        <AuthProvider>
          {children}
          <FeedbackWidget />
        </AuthProvider>
      </body>
    </html>
  )
}
