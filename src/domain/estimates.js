/** @import { SessionLog, Task } from './types.js' */

/**
 * Logged work per task in sessions, counting minutes against the current
 * focus length so an interrupted session counts as a fraction.
 *
 * @param {readonly SessionLog[]} logs
 * @param {number} focusMinutes
 * @returns {Map<string, number>}
 */
export function loggedSessionsByTask(logs, focusMinutes) {
  /** @type {Map<string, number>} */
  const sessions = new Map();
  for (const log of logs) {
    if (log.taskId !== null) sessions.set(log.taskId, (sessions.get(log.taskId) ?? 0) + log.minutes / focusMinutes);
  }
  return sessions;
}

/**
 * How much longer finished work took than estimated: total logged over
 * total estimate. A ratio of sums, so one tiny task cannot swing it.
 * Tasks finished with nothing logged are left out, as their work happened
 * outside the planner.
 *
 * @param {readonly Task[]} tasks
 * @param {Map<string, number>} logged
 * @returns {number | null} null until a finished task has logged work
 */
export function correctionFactor(tasks, logged) {
  let estimated = 0;
  let actual = 0;
  for (const task of tasks) {
    const sessions = logged.get(task.id) ?? 0;
    if (task.finishedOn === null || sessions === 0) continue;
    estimated += task.estimate;
    actual += sessions;
  }
  return estimated === 0 ? null : actual / estimated;
}

/**
 * @param {Task} task
 * @param {Map<string, number>} logged
 * @param {number | null} factor
 * @returns {number} sessions, zero when the task has reached or passed its adjusted estimate
 */
export function likelyRemaining(task, logged, factor) {
  return Math.max(0, task.estimate * (factor ?? 1) - (logged.get(task.id) ?? 0));
}
