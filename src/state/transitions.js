/**
 * @import { AppState, AreaId, Deadline, FixedEntry, LocalDate, SessionEntry, Settings, SlotEntry, SlotKey, Task,
 *   Week } from '../domain/types.js'
 * @import { FinishedFocus } from '../domain/timer.js'
 */
import { fixedEntriesFrom, generateWeek } from '../domain/allocation.js';
import { REVIEW_SLOT_KEY, localDateOf } from '../domain/calendar.js';
import { validateDeadline, validateSettings, validateSlotEntry, validateTask } from '../domain/schema.js';
import { advance, startFocus, stop } from '../domain/timer.js';

// Every transition is pure: it takes the state and returns a new one,
// with the current time and any new id passed in by the caller.

const MAX_NOTE_LENGTH = 2000;

export class UnknownIdError extends Error {
  /**
   * @param {string} kind
   * @param {string} id
   */
  constructor(kind, id) {
    super(`no ${kind} with id ${JSON.stringify(id)}`);
    this.name = 'UnknownIdError';
  }
}

export class DuplicateIdError extends Error {
  /**
   * @param {string} kind
   * @param {string} id
   */
  constructor(kind, id) {
    super(`a ${kind} with id ${JSON.stringify(id)} already exists`);
    this.name = 'DuplicateIdError';
  }
}

/**
 * Creates the plan for a week from the recurring events the first time
 * the week is needed. An existing plan is left alone.
 *
 * @param {AppState} state
 * @param {LocalDate} monday
 * @returns {AppState}
 */
export function ensureWeek(state, monday) {
  if (state.weeks[monday]) return state;
  const slots = generateWeek(state.settings.areas, fixedEntriesFrom(state.settings.recurring));
  return withWeek(state, monday, { slots });
}

/**
 * Replans the sessions of a week from the current targets, keeping its
 * fixed events, including ones added to this week only.
 *
 * @param {AppState} state
 * @param {LocalDate} monday
 * @returns {AppState}
 */
export function regenerateWeek(state, monday) {
  const existing = state.weeks[monday];
  if (!existing) return ensureWeek(state, monday);
  /** @type {Partial<Record<SlotKey, FixedEntry>>} */
  const fixed = {};
  for (const [key, entry] of entries(existing.slots)) {
    if (entry.kind === 'fixed') fixed[key] = entry;
  }
  return withWeek(state, monday, { slots: generateWeek(state.settings.areas, fixed) });
}

/**
 * @param {AppState} state
 * @param {LocalDate} monday
 * @param {SlotKey} key
 * @param {SessionEntry | FixedEntry} entry
 * @returns {AppState}
 */
export function editSlot(state, monday, key, entry) {
  if (key === REVIEW_SLOT_KEY) throw new Error(`slot ${key} is reserved for the weekly review`);
  if (entry.kind === 'session' && entry.taskId !== null) requireTask(state, entry.taskId);
  const valid = validateSlotEntry(entry, `slot ${key}`);
  const ensured = ensureWeek(state, monday);
  const week = /** @type {Week} */ (ensured.weeks[monday]);
  return withWeek(ensured, monday, { slots: { ...week.slots, [key]: valid } });
}

/**
 * Starts focus for a planned slot or, with a null slot, an unplanned
 * session. The session keeps the date it started on and the lengths in
 * force at that moment.
 *
 * @param {AppState} state
 * @param {{ slotKey: SlotKey | null, areaId: AreaId, taskId: string | null }} session
 * @param {Date} now
 * @returns {AppState}
 */
export function startSession(state, session, now) {
  if (session.taskId !== null) requireTask(state, session.taskId);
  const { focusMinutes, breakMinutes } = state.settings;
  const context = { ...session, date: localDateOf(now), focusMinutes, breakMinutes };
  return { ...state, timer: startFocus(state.timer, context, now) };
}

/**
 * @param {AppState} state
 * @param {Date} now
 * @param {string} newLogId used only if a focus block has ended
 * @returns {AppState}
 */
export function advanceTimer(state, now, newLogId) {
  const { timer, finished } = advance(state.timer, now);
  if (timer === state.timer && finished === null) return state;
  return withLog({ ...state, timer }, finished, newLogId);
}

/**
 * @param {AppState} state
 * @param {Date} now
 * @param {string} newLogId used only if the stop produces a log
 * @returns {AppState}
 */
export function stopSession(state, now, newLogId) {
  const { timer, finished } = stop(state.timer, now);
  return withLog({ ...state, timer }, finished, newLogId);
}

/**
 * @param {AppState} state
 * @param {string} logId
 * @param {string} note
 * @returns {AppState}
 */
export function noteLog(state, logId, note) {
  if (!state.logs.some((log) => log.id === logId)) throw new UnknownIdError('session log', logId);
  const trimmed = note.trim();
  if (trimmed.length > MAX_NOTE_LENGTH) throw new Error(`a note is at most ${MAX_NOTE_LENGTH} characters, got ${trimmed.length}`);
  return { ...state, logs: state.logs.map((log) => (log.id === logId ? { ...log, note: trimmed } : log)) };
}

/**
 * @param {AppState} state
 * @param {{ id: string, areaId: AreaId, title: string, estimate: number }} task
 * @returns {AppState}
 */
export function addTask(state, task) {
  if (state.tasks.some((existing) => existing.id === task.id)) throw new DuplicateIdError('task', task.id);
  return { ...state, tasks: [...state.tasks, validateTask({ ...task, finishedOn: null }, 'task')] };
}

/**
 * @param {AppState} state
 * @param {string} taskId
 * @param {Partial<Pick<Task, 'areaId' | 'title' | 'estimate'>>} changes
 * @returns {AppState}
 */
export function editTask(state, taskId, changes) {
  const updated = validateTask({ ...requireTask(state, taskId), ...changes }, 'task');
  return { ...state, tasks: state.tasks.map((task) => (task.id === taskId ? updated : task)) };
}

/**
 * Marks a task finished on a date, or open again with null.
 *
 * @param {AppState} state
 * @param {string} taskId
 * @param {LocalDate | null} finishedOn
 * @returns {AppState}
 */
export function setTaskFinished(state, taskId, finishedOn) {
  requireTask(state, taskId);
  return { ...state, tasks: state.tasks.map((task) => (task.id === taskId ? { ...task, finishedOn } : task)) };
}

/**
 * Removes a task and clears it from planned slots. Logs keep the id so
 * their time still counts towards the area.
 *
 * @param {AppState} state
 * @param {string} taskId
 * @returns {AppState}
 */
export function deleteTask(state, taskId) {
  requireTask(state, taskId);
  /** @type {Record<LocalDate, Week>} */
  const weeks = {};
  for (const [monday, week] of Object.entries(state.weeks)) {
    /** @type {Partial<Record<SlotKey, SlotEntry>>} */
    const slots = {};
    for (const [key, entry] of entries(week.slots)) {
      slots[key] = entry.kind === 'session' && entry.taskId === taskId ? { ...entry, taskId: null } : entry;
    }
    weeks[monday] = { slots: /** @type {Week['slots']} */ (slots) };
  }
  return { ...state, weeks, tasks: state.tasks.filter((task) => task.id !== taskId) };
}

/**
 * @param {AppState} state
 * @param {Deadline} deadline
 * @returns {AppState}
 */
export function addDeadline(state, deadline) {
  if (state.deadlines.some((existing) => existing.id === deadline.id)) throw new DuplicateIdError('deadline', deadline.id);
  return { ...state, deadlines: [...state.deadlines, validateDeadline(deadline, 'deadline')] };
}

/**
 * @param {AppState} state
 * @param {string} deadlineId
 * @param {Partial<Omit<Deadline, 'id'>>} changes
 * @returns {AppState}
 */
export function editDeadline(state, deadlineId, changes) {
  const existing = state.deadlines.find((deadline) => deadline.id === deadlineId);
  if (!existing) throw new UnknownIdError('deadline', deadlineId);
  const updated = validateDeadline({ ...existing, ...changes }, 'deadline');
  return { ...state, deadlines: state.deadlines.map((deadline) => (deadline.id === deadlineId ? updated : deadline)) };
}

/**
 * @param {AppState} state
 * @param {string} deadlineId
 * @returns {AppState}
 */
export function deleteDeadline(state, deadlineId) {
  if (!state.deadlines.some((deadline) => deadline.id === deadlineId)) throw new UnknownIdError('deadline', deadlineId);
  return { ...state, deadlines: state.deadlines.filter((deadline) => deadline.id !== deadlineId) };
}

/**
 * Applies new settings to future weeks only: existing plans are kept
 * until regenerated, and a running session keeps its lengths.
 *
 * @param {AppState} state
 * @param {Partial<Settings>} changes
 * @returns {AppState}
 */
export function updateSettings(state, changes) {
  return { ...state, settings: validateSettings({ ...state.settings, ...changes }) };
}

/**
 * @param {AppState} state
 * @param {FinishedFocus | null} finished
 * @param {string} id
 * @returns {AppState}
 */
function withLog(state, finished, id) {
  if (finished === null) return state;
  const { context, startedAt, minutes, outcome } = finished;
  const log = { id, date: context.date, slotKey: context.slotKey, areaId: context.areaId, taskId: context.taskId, startedAt, minutes, outcome, note: '' };
  if (state.logs.some((existing) => existing.id === id)) throw new DuplicateIdError('session log', id);
  return { ...state, logs: [...state.logs, log] };
}

/**
 * @param {AppState} state
 * @param {LocalDate} monday
 * @param {Week} week
 * @returns {AppState}
 */
function withWeek(state, monday, week) {
  return { ...state, weeks: { ...state.weeks, [monday]: week } };
}

/**
 * @param {AppState} state
 * @param {string} taskId
 * @returns {Task}
 */
function requireTask(state, taskId) {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new UnknownIdError('task', taskId);
  return task;
}

/**
 * @param {Week['slots']} slots
 * @returns {[SlotKey, SlotEntry][]}
 */
function entries(slots) {
  return /** @type {[SlotKey, SlotEntry][]} */ (Object.entries(slots));
}
