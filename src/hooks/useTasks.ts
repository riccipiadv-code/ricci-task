import { useState, useEffect, useCallback } from 'react'
import { Task, Settings, DefaultViewFilter } from '@/types/task'
import { taskService } from '@/services/taskService'

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>(() => taskService.getTasks())
  const [settings, setSettings] = useState<Settings>(() => taskService.getSettings())

  const refresh = useCallback(() => {
    setTasks(taskService.getTasks())
    setSettings(taskService.getSettings())
  }, [])

  useEffect(() => {
    // Initial sync
    refresh()

    // Subscribe to internal custom events and cross-tab storage events
    const unsubscribe = taskService.subscribe(refresh)
    return () => unsubscribe()
  }, [refresh])

  const saveTask = useCallback(
    (taskData: Omit<Task, 'id' | 'createdAt'> & { id?: string; createdAt?: string }) => {
      const created = taskService.saveTask(taskData)
      refresh()
      return created
    },
    [refresh],
  )

  const updateTask = useCallback(
    (id: string, updates: Partial<Omit<Task, 'id'>>) => {
      const updated = taskService.updateTask(id, updates)
      refresh()
      return updated
    },
    [refresh],
  )

  const deleteTask = useCallback(
    (id: string) => {
      const deleted = taskService.deleteTask(id)
      refresh()
      return deleted
    },
    [refresh],
  )

  const toggleTaskStatus = useCallback(
    (id: string): { task: Task; concluded: boolean } => {
      const current = tasks.find((t) => t.id === id)
      const newStatus = current?.status === 'concluida' ? 'pendente' : 'concluida'
      const updated = taskService.updateTask(id, { status: newStatus })
      refresh()
      return { task: updated, concluded: newStatus === 'concluida' }
    },
    [tasks, refresh],
  )

  const updateSettings = useCallback(
    (updates: Partial<Settings>) => {
      const updated = taskService.saveSettings(updates)
      refresh()
      return updated
    },
    [refresh],
  )

  const resetAllData = useCallback(() => {
    taskService.resetAllData()
    refresh()
  }, [refresh])

  return {
    tasks,
    settings,
    refresh,
    saveTask,
    updateTask,
    deleteTask,
    toggleTaskStatus,
    updateSettings,
    resetAllData,
  }
}
