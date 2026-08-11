import { deleteProject, deleteTask, listTasks, type AppDatabase } from './database'

type TaskExecutionCleaner = {
  stop: (taskId: string) => Promise<unknown>
}

export async function deleteTaskWithProcesses(
  db: AppDatabase,
  cleaner: TaskExecutionCleaner,
  taskId: string
): Promise<void> {
  await cleaner.stop(taskId)
  deleteTask(db, taskId)
}

export async function deleteProjectWithProcesses(
  db: AppDatabase,
  cleaner: TaskExecutionCleaner,
  projectId: string
): Promise<void> {
  const taskIds = listTasks(db, projectId).map((task) => task.id)
  await Promise.all(taskIds.map((taskId) => cleaner.stop(taskId)))
  deleteProject(db, projectId)
}
