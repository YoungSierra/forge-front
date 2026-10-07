import { useEffect, useState } from 'react'
import { guardarLocal } from '@/lib/local-store'

export type Theme = 'dark' | 'light'

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('dark')

  useEffect(() => {
    const stored = localStorage.getItem('forge-theme') as Theme | null
    if (stored === 'light') setThemeState('light')
  }, [])

  function setTheme(t: Theme) {
    setThemeState(t)
    guardarLocal('forge-theme', t)
    if (t === 'light') {
      document.documentElement.setAttribute('data-theme', 'light')
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
  }

  function toggle() {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  return { theme, toggle }
}
