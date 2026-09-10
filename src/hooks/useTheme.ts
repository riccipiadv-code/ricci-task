import { useEffect, useState } from 'react'
import { ThemeMode } from '@/types/task'
import { taskService } from '@/services/taskService'

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    return taskService.getSettings().theme || 'claro'
  })

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'escuro') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [theme])

  useEffect(() => {
    const unsubscribe = taskService.subscribe(() => {
      const current = taskService.getSettings().theme
      setThemeState(current)
    })
    return () => unsubscribe()
  }, [])

  const setTheme = (newTheme: ThemeMode) => {
    taskService.saveSettings({ theme: newTheme })
    setThemeState(newTheme)
  }

  const toggleTheme = () => {
    const next = theme === 'claro' ? 'escuro' : 'claro'
    setTheme(next)
  }

  return { theme, setTheme, toggleTheme, isDark: theme === 'escuro' }
}
