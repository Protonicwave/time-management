/** @import { AppState, AreaId, Deadline, IsoInstant, LocalDate, SessionLog, SlotEntry, SlotKey, Week } from '../domain/types.js' */
import { SLOT_IDS, dayIdOf, localDateOf, mondayOf, nextLibraryDay, slotKey } from '../domain/calendar.js';
import { ensureWeek } from './transitions.js';

// Read-only views of the state for one day, derived on every render.

/** @typedef {{ slotKey: SlotKey | null, areaId: AreaId, taskId: string | null }} Session what startSession needs */

/** @typedef {{ status: 'open' } | { status: 'live' } | { status: 'logged', minutes: number, completed: boolean }} SlotStatus */

/**
 * @typedef {object} SlotRow
 * @property {SlotKey} key
 * @property {number} hour local start hour
 * @property {SlotEntry} entry
 * @property {Session | null} session what the timer would log here; null for the review and unlinked fixed events
 * @property {SlotStatus} status
 */

/**
 * @typedef {object} UnplannedRow
 * @property {IsoInstant} startedAt
 * @property {AreaId} areaId
 * @property {string | null} taskId
 * @property {SlotStatus} status
 * @property {SessionLog | null} log null while running
 */

/** @typedef {{ logged: number, planned: number, stopped: number, finished: number, focusMinutes: number }} DaySummary */

export const LAST_SLOT_HOUR = Number(SLOT_IDS[SLOT_IDS.length - 1]);

/**
 * @typedef {{ kind: 'setup' }
 *   | { kind: 'focus', number: number, areaName: string, taskTitle: string | null }
 *   | { kind: 'break', next: SlotRow | null }
 *   | { kind: 'next-today', row: SlotRow, session: Session, early: boolean }
 *   | { kind: 'next-day', date: LocalDate, row: SlotRow | null }} DockModel
 */

/**
 * No week has ever been planned.
 * @param {AppState} state
 * @returns {boolean}
 */
export function isFirstRun(state) {
  return Object.keys(state.weeks).length === 0;
}

/**
 * The week Today is about: this one on a library day, the next one at the
 * weekend.
 * @param {LocalDate} date
 * @returns {LocalDate}
 */
export function weekShownOn(date) {
  return mondayOf(dayIdOf(date) === null ? nextLibraryDay(date) : date);
}

/**
 * @param {readonly SessionLog[]} logs
 * @param {LocalDate} date
 * @returns {SessionLog[]}
 */
export function logsOn(logs, date) {
  return logs.filter((log) => log.date === date);
}

/**
 * The planned slots of a library day with what has happened in each.
 * A week not yet created is shown as ensureWeek would create it, so a
 * preview and the stored plan cannot differ.
 *
 * @param {AppState} state
 * @param {LocalDate} date
 * @returns {SlotRow[]} empty at the weekend
 */
export function slotRows(state, date) {
  const dayId = dayIdOf(date);
  if (dayId === null) return [];
  const monday = mondayOf(date);
  const week = /** @type {Week} */ (ensureWeek(state, monday).weeks[monday]);
  const logs = logsOn(state.logs, date);
  return SLOT_IDS.map((slotId) => {
    const key = slotKey(dayId, slotId);
    const entry = week.slots[key];
    return { key, hour: Number(slotId), entry, session: sessionOf(key, entry), status: statusOf(state, date, key, logs) };
  });
}

/**
 * The slot to start next: the first open slot whose focus time has not
 * passed, so a slot can be started late but not once its focus would
 * have ended, which would run the last one past closing.
 *
 * @param {readonly SlotRow[]} rows
 * @param {Date} now
 * @param {number} focusMinutes
 * @returns {SlotRow | null}
 */
export function nextSlot(rows, now, focusMinutes) {
  const minute = now.getHours() * 60 + now.getMinutes();
  return rows.find((row) => row.session !== null && row.status.status === 'open' && minute < row.hour * 60 + focusMinutes) ?? null;
}

/**
 * Sessions started outside the plan on a day, logged or running, by
 * start time. Each is its own row, as there is no slot to group them by.
 *
 * @param {AppState} state
 * @param {LocalDate} date
 * @returns {UnplannedRow[]}
 */
export function unplannedRows(state, date) {
  /** @type {UnplannedRow[]} */
  const rows = logsOn(state.logs, date)
    .filter((log) => log.slotKey === null)
    .map((log) => ({
      startedAt: log.startedAt,
      areaId: log.areaId,
      taskId: log.taskId,
      status: { status: 'logged', minutes: log.minutes, completed: log.outcome === 'completed' },
      log,
    }));
  const { timer } = state;
  if (timer.phase === 'focus' && timer.context.slotKey === null && timer.context.date === date) {
    rows.push({ startedAt: timer.startedAt, areaId: timer.context.areaId, taskId: timer.context.taskId, status: { status: 'live' }, log: null });
  }
  return rows.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/**
 * The session that has just finished, if the day has one.
 * @param {readonly SessionLog[]} logs
 * @param {LocalDate} date
 * @returns {SessionLog | null}
 */
export function latestLog(logs, date) {
  /** @type {SessionLog | null} */
  let latest = null;
  for (const log of logsOn(logs, date)) {
    if (latest === null || log.startedAt > latest.startedAt) latest = log;
  }
  return latest;
}

/**
 * @param {Date} now
 * @param {number} focusMinutes
 * @returns {boolean} true once focus in the last slot of the day would have ended
 */
export function isClosingTime(now, focusMinutes) {
  return now.getHours() * 60 + now.getMinutes() >= LAST_SLOT_HOUR * 60 + focusMinutes;
}

/**
 * @param {AppState} state
 * @param {LocalDate} date
 * @returns {DaySummary}
 */
export function summariseDay(state, date) {
  const logs = logsOn(state.logs, date);
  return {
    logged: logs.length,
    planned: slotRows(state, date).filter((row) => row.session !== null).length,
    stopped: logs.filter((log) => log.outcome === 'interrupted').length,
    finished: state.tasks.filter((task) => task.finishedOn === date).length,
    focusMinutes: logs.reduce((sum, log) => sum + log.minutes, 0),
  };
}

/**
 * The slot whose task is chosen when closing the day: the first session
 * of the next library day, since only a session takes a task.
 *
 * @param {AppState} state
 * @param {LocalDate} date
 * @returns {{ date: LocalDate, row: SlotRow | null }}
 */
export function firstSessionOfNextDay(state, date) {
  const next = nextLibraryDay(date);
  return { date: next, row: slotRows(state, next).find((row) => row.entry.kind === 'session') ?? null };
}

/**
 * Slots that can still be logged today, the running one included.
 * @param {readonly SlotRow[]} rows
 * @returns {number}
 */
export function sessionsToGo(rows) {
  return rows.filter((row) => row.session !== null && row.status.status !== 'logged').length;
}

/**
 * @param {readonly Deadline[]} deadlines
 * @param {LocalDate} today
 * @param {number} count
 * @returns {Deadline[]} due today or later, soonest first
 */
export function nearestDeadlines(deadlines, today, count) {
  return deadlines
    .filter((deadline) => deadline.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, count);
}

/**
 * @param {AppState} state
 * @param {Date} now
 * @returns {DockModel}
 */
export function describeDock(state, now) {
  const { timer } = state;
  if (timer.phase === 'focus') {
    const { context } = timer;
    return {
      kind: 'focus',
      number: logsOn(state.logs, context.date).length + 1,
      areaName: areaName(state, context.areaId),
      taskTitle: taskTitle(state, context.taskId),
    };
  }

  const today = localDateOf(now);
  const next = nextSlot(slotRows(state, today), now, state.settings.focusMinutes);
  if (timer.phase === 'break') return { kind: 'break', next };
  if (isFirstRun(state)) return { kind: 'setup' };
  if (next?.session) {
    return { kind: 'next-today', row: next, session: next.session, early: now.getHours() < next.hour };
  }
  const date = nextLibraryDay(today);
  return { kind: 'next-day', date, row: slotRows(state, date).find((row) => row.session !== null) ?? null };
}

/**
 * @param {AppState} state
 * @param {AreaId} areaId
 * @returns {string}
 */
export function areaName(state, areaId) {
  return state.settings.areas.find((area) => area.id === areaId)?.name ?? areaId;
}

/**
 * @param {AppState} state
 * @param {string | null} taskId
 * @returns {string | null} null for no task; logs can outlive their task
 */
export function taskTitle(state, taskId) {
  if (taskId === null) return null;
  return state.tasks.find((task) => task.id === taskId)?.title ?? 'Deleted task';
}

/**
 * The one-line name of what a slot holds: its task, its fixed label, or
 * its area when no task is set.
 *
 * @param {AppState} state
 * @param {SlotEntry} entry
 * @returns {string}
 */
export function entryTitle(state, entry) {
  switch (entry.kind) {
    case 'review':
      return 'Weekly review';
    case 'fixed':
      return entry.label;
    case 'session':
      return taskTitle(state, entry.taskId) ?? areaName(state, entry.areaId);
  }
}

/**
 * @param {SlotKey} key
 * @param {SlotEntry} entry
 * @returns {Session | null}
 */
function sessionOf(key, entry) {
  if (entry.kind === 'session') return { slotKey: key, areaId: entry.areaId, taskId: entry.taskId };
  if (entry.kind === 'fixed' && entry.areaId !== null) return { slotKey: key, areaId: entry.areaId, taskId: null };
  return null;
}

/**
 * A slot restarted after stopping early sums its logs; one completed log
 * makes it complete.
 *
 * @param {AppState} state
 * @param {LocalDate} date
 * @param {SlotKey} key
 * @param {readonly SessionLog[]} logs the day's logs
 * @returns {SlotStatus}
 */
function statusOf(state, date, key, logs) {
  const { timer } = state;
  if (timer.phase === 'focus' && timer.context.date === date && timer.context.slotKey === key) return { status: 'live' };
  const slotLogs = logs.filter((log) => log.slotKey === key);
  if (slotLogs.length === 0) return { status: 'open' };
  return {
    status: 'logged',
    minutes: slotLogs.reduce((sum, log) => sum + log.minutes, 0),
    completed: slotLogs.some((log) => log.outcome === 'completed'),
  };
}
