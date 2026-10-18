/** @import { IsoInstant, Outcome, SessionContext, TimerState } from './types.js' */

const MILLISECONDS_PER_MINUTE = 60_000;

/**
 * A focus block that has ended, ready to become a session log.
 * @typedef {{ context: SessionContext, startedAt: IsoInstant, minutes: number, outcome: Outcome }} FinishedFocus
 */

/** @typedef {{ timer: TimerState, finished: FinishedFocus | null }} TimerStep */

/** @type {TimerState} */
export const IDLE = { phase: 'idle' };

export class TimerStateError extends Error {
  /**
   * @param {string} action
   * @param {TimerState['phase']} phase
   */
  constructor(action, phase) {
    super(`cannot ${action} while the timer is in phase "${phase}"`);
    this.name = 'TimerStateError';
  }
}

/**
 * Starting during a break ends the break early.
 * @param {TimerState} timer
 * @param {SessionContext} context
 * @param {Date} now
 * @returns {TimerState}
 */
export function startFocus(timer, context, now) {
  if (timer.phase === 'focus') throw new TimerStateError('start a session', timer.phase);
  return { phase: 'focus', startedAt: now.toISOString(), context };
}

/**
 * Moves the timer to wherever the wall clock says it should be. A laptop
 * that slept through the end of focus and break gets one completed
 * session with its true start time, and an idle timer.
 *
 * @param {TimerState} timer
 * @param {Date} now
 * @returns {TimerStep}
 */
export function advance(timer, now) {
  switch (timer.phase) {
    case 'idle':
      return { timer, finished: null };
    case 'break':
      return { timer: hasElapsed(timer.startedAt, timer.breakMinutes, now) ? IDLE : timer, finished: null };
    case 'focus': {
      const { context, startedAt } = timer;
      if (!hasElapsed(startedAt, context.focusMinutes, now)) return { timer, finished: null };
      const finished = { context, startedAt, minutes: context.focusMinutes, outcome: /** @type {const} */ ('completed') };
      const breakStartedAt = new Date(Date.parse(startedAt) + context.focusMinutes * MILLISECONDS_PER_MINUTE);
      /** @type {TimerState} */
      const onBreak = { phase: 'break', startedAt: breakStartedAt.toISOString(), breakMinutes: context.breakMinutes };
      return { timer: hasElapsed(onBreak.startedAt, onBreak.breakMinutes, now) ? IDLE : onBreak, finished };
    }
  }
}

/**
 * Ends focus or a break now. Focus stopped before its end is logged as
 * interrupted in whole minutes; under one minute is treated as a false
 * start and not logged.
 *
 * @param {TimerState} timer
 * @param {Date} now
 * @returns {TimerStep}
 */
export function stop(timer, now) {
  if (timer.phase !== 'focus') return { timer: IDLE, finished: null };
  const advanced = advance(timer, now);
  if (advanced.finished) return { timer: IDLE, finished: advanced.finished };

  const minutes = Math.floor(Math.max(0, now.getTime() - Date.parse(timer.startedAt)) / MILLISECONDS_PER_MINUTE);
  if (minutes < 1) return { timer: IDLE, finished: null };
  return { timer: IDLE, finished: { context: timer.context, startedAt: timer.startedAt, minutes, outcome: 'interrupted' } };
}

/**
 * What the countdown shows. Derived from the start time on every read, so
 * a throttled or sleeping tab shows the right time as soon as it wakes.
 *
 * @param {TimerState} timer
 * @param {Date} now
 * @returns {{ remainingSeconds: number, progress: number } | null} progress from 0 to 1; null when idle
 */
export function readTimer(timer, now) {
  if (timer.phase === 'idle') return null;
  const total = (timer.phase === 'focus' ? timer.context.focusMinutes : timer.breakMinutes) * MILLISECONDS_PER_MINUTE;
  const elapsed = Math.min(total, Math.max(0, now.getTime() - Date.parse(timer.startedAt)));
  return { remainingSeconds: Math.ceil((total - elapsed) / 1000), progress: total === 0 ? 1 : elapsed / total };
}

/**
 * @param {IsoInstant} startedAt
 * @param {number} minutes
 * @param {Date} now
 * @returns {boolean}
 */
function hasElapsed(startedAt, minutes, now) {
  return now.getTime() >= Date.parse(startedAt) + minutes * MILLISECONDS_PER_MINUTE;
}
