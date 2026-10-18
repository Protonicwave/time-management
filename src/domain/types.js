// Shared vocabulary for the planner. Typedefs only.

/** @typedef {'independent' | 'group' | 'careers' | 'module-1' | 'module-2' | 'module-3' | 'buffer'} AreaId */
/** @typedef {'mon' | 'tue' | 'wed' | 'thu' | 'fri'} DayId */
/** @typedef {'09' | '10' | '11' | '13' | '14' | '15' | '16'} SlotId */
/** @typedef {`${DayId}-${SlotId}`} SlotKey */

/**
 * A local calendar date written as YYYY-MM-DD.
 * @typedef {string} LocalDate
 */

/**
 * An instant written by Date.prototype.toISOString.
 * @typedef {string} IsoInstant
 */

/** @typedef {{ id: AreaId, name: string, target: number }} Area */
/** @typedef {{ dayId: DayId, slotId: SlotId, label: string, areaId: AreaId | null }} FixedEvent */

/** @typedef {{ kind: 'session', areaId: AreaId, taskId: string | null }} SessionEntry */
/** @typedef {{ kind: 'fixed', label: string, areaId: AreaId | null }} FixedEntry */
/** @typedef {{ kind: 'review' }} ReviewEntry */
/** @typedef {SessionEntry | FixedEntry | ReviewEntry} SlotEntry */

/**
 * Every slot of a week has an entry, so there is no "unplanned" slot state.
 * @typedef {{ slots: Record<SlotKey, SlotEntry> }} Week
 */

/** @typedef {{ id: string, areaId: AreaId, title: string, estimate: number, finishedOn: LocalDate | null }} Task */

/** @typedef {'completed' | 'interrupted'} Outcome */

/**
 * @typedef {object} SessionLog
 * @property {string} id
 * @property {LocalDate} date the date the session started on
 * @property {SlotKey | null} slotKey null for an unplanned session
 * @property {AreaId} areaId
 * @property {string | null} taskId may refer to a deleted task
 * @property {IsoInstant} startedAt
 * @property {number} minutes whole minutes of focus
 * @property {Outcome} outcome
 * @property {string} note
 */

/** @typedef {{ id: string, title: string, date: LocalDate, areaId: AreaId }} Deadline */

/**
 * What a focus block is for, captured when it starts so later setting
 * changes do not alter a running session.
 * @typedef {object} SessionContext
 * @property {LocalDate} date
 * @property {SlotKey | null} slotKey
 * @property {AreaId} areaId
 * @property {string | null} taskId
 * @property {number} focusMinutes
 * @property {number} breakMinutes
 */

/**
 * @typedef {{ phase: 'idle' }
 *   | { phase: 'focus', startedAt: IsoInstant, context: SessionContext }
 *   | { phase: 'break', startedAt: IsoInstant, breakMinutes: number }} TimerState
 */

/** @typedef {'system' | 'light' | 'dark'} Theme */

/**
 * @typedef {object} Settings
 * @property {number} focusMinutes
 * @property {number} breakMinutes
 * @property {Area[]} areas all seven areas, in priority order
 * @property {FixedEvent[]} recurring
 * @property {Theme} theme
 */

/**
 * @typedef {object} AppState
 * @property {1} schemaVersion
 * @property {Settings} settings
 * @property {Record<LocalDate, Week>} weeks keyed by the Monday of each week
 * @property {Task[]} tasks
 * @property {SessionLog[]} logs
 * @property {Deadline[]} deadlines
 * @property {TimerState} timer
 * @property {LocalDate | null} lastExportOn
 */

export {};
