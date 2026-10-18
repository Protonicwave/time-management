/** @import { AppState, AreaId, LocalDate, Task } from '../domain/types.js' */
import { mondayOf } from '../domain/calendar.js';
import { correctionFactor, likelyRemaining, loggedSessionsByTask } from '../domain/estimates.js';

// Read-only views of the task list, derived on every render.

/** @typedef {{ kind: 'left', sessions: number } | { kind: 'over' } | { kind: 'done' }} LikelyLeft */

/**
 * @typedef {object} TaskRow
 * @property {Task} task
 * @property {number} logged sessions, fractional for work stopped early
 * @property {LikelyLeft} left
 */

/**
 * @typedef {object} TaskGroup
 * @property {AreaId} areaId
 * @property {TaskRow[]} open in the order they were added
 * @property {TaskRow[]} recent finished this week, so a task ticked off does not vanish
 * @property {TaskRow[]} earlier finished in any other week, newest first
 */

/**
 * Tasks by area in priority order. The buffer is for overflow and holds
 * no tasks of its own, so it only appears once it has some.
 *
 * @param {AppState} state
 * @param {LocalDate} today
 * @returns {TaskGroup[]}
 */
export function taskGroups(state, today) {
  const logged = loggedSessionsByTask(state.logs, state.settings.focusMinutes);
  const factor = correctionFactor(state.tasks, logged);
  const thisMonday = mondayOf(today);

  /** @param {Task} task @returns {TaskRow} */
  const row = (task) => ({ task, logged: logged.get(task.id) ?? 0, left: likelyLeft(task, logged, factor) });

  return state.settings.areas
    .map((area) => {
      const tasks = state.tasks.filter((task) => task.areaId === area.id);
      const finished = tasks
        .filter((task) => task.finishedOn !== null)
        .sort((a, b) => (b.finishedOn ?? '').localeCompare(a.finishedOn ?? ''));
      return {
        areaId: area.id,
        open: tasks.filter((task) => task.finishedOn === null).map(row),
        recent: finished.filter((task) => mondayOf(/** @type {LocalDate} */ (task.finishedOn)) === thisMonday).map(row),
        earlier: finished.filter((task) => mondayOf(/** @type {LocalDate} */ (task.finishedOn)) !== thisMonday).map(row),
      };
    })
    .filter((group) => group.areaId !== 'buffer' || group.open.length + group.recent.length + group.earlier.length > 0);
}

/**
 * How estimates have compared with the work, and how many finished tasks
 * that rests on.
 *
 * @param {AppState} state
 * @returns {{ factor: number | null, basis: number }}
 */
export function estimateLearning(state) {
  const logged = loggedSessionsByTask(state.logs, state.settings.focusMinutes);
  return {
    factor: correctionFactor(state.tasks, logged),
    basis: state.tasks.filter((task) => task.finishedOn !== null && (logged.get(task.id) ?? 0) > 0).length,
  };
}

/**
 * @param {Task} task
 * @param {Map<string, number>} logged
 * @param {number | null} factor
 * @returns {LikelyLeft}
 */
function likelyLeft(task, logged, factor) {
  if (task.finishedOn !== null) return { kind: 'done' };
  const sessions = likelyRemaining(task, logged, factor);
  // An estimate is at least one session, so nothing left means work has
  // been logged up to or past the adjusted estimate.
  return sessions === 0 ? { kind: 'over' } : { kind: 'left', sessions };
}
