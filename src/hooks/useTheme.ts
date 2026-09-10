import { useEffect, useState } from 'react'
import { ThemeMode } from '@/types/task'
import { controleService } from '@/services/controleService'

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    return controleService.getSettings().theme || 'claro'
  })

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'escuro') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [theme])

  const setTheme = (newTheme: ThemeMode) => {
    controleService.saveSettings({ theme: newTheme })
    setThemeState(newTheme)
  }

  const toggleTheme = () => {
    const next = theme === 'claro' ? 'escuro' : 'claro'
    setTheme(next)
  }

  return { theme, setTheme, toggleTheme, isDark: theme === 'escuro' }
}
