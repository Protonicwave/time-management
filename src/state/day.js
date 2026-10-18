/** @import { AppState, AreaId, LocalDate, SessionLog, SlotEntry, SlotKey, Week } from '../domain/types.js' */
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
 * The slot to start next: the first open slot that has not yet ended by
 * the clock, so a slot can still be started late within its hour.
 *
 * @param {readonly SlotRow[]} rows
 * @param {Date} now
 * @returns {SlotRow | null}
 */
export function nextSlot(rows, now) {
  const minute = now.getHours() * 60 + now.getMinutes();
  return rows.find((row) => row.session !== null && row.status.status === 'open' && minute < (row.hour + 1) * 60) ?? null;
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
  const next = nextSlot(slotRows(state, today), now);
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
