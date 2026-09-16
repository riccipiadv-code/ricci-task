import { useEffect, useState } from 'react'
import { ThemeMode } from '@/types/task'
import { controleService } from '@/services/controleService'

const THEME_STORAGE_KEY = 'ricci_task_theme'

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY)
      if (stored === 'escuro' || stored === 'claro') {
        return stored
      }
      // Verifica settings gerais caso existam
      const rawSettings = localStorage.getItem('ricci_task_settings')
      if (rawSettings) {
        const parsed = JSON.parse(rawSettings)
        if (parsed.theme === 'escuro' || parsed.theme === 'claro') {
          return parsed.theme
        }
      }
    } catch {
      // fallback
    }
    return 'claro'
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
    try {
      localStorage.setItem(THEME_STORAGE_KEY, newTheme)
      const rawSettings = localStorage.getItem('ricci_task_settings')
      const current = rawSettings ? JSON.parse(rawSettings) : {}
      localStorage.setItem(
        'ricci_task_settings',
        JSON.stringify({ ...current, theme: newTheme }),
      )
    } catch (err) {
      console.warn('Erro ao salvar tema:', err)
    }
    setThemeState(newTheme)
  }

  const toggleTheme = () => {
    const next = theme === 'claro' ? 'escuro' : 'claro'
    setTheme(next)
  }

  return { theme, setTheme, toggleTheme, isDark: theme === 'escuro' }
}
