/** @import { Area, AreaId, DayId, LocalDate, SessionLog, SlotId, Task, Week } from './types.js' */
import { DAY_IDS, SLOT_IDS, mondayOf, parseSlotKey } from './calendar.js';

/** @typedef {{ areaId: AreaId, planned: number, logged: number }} AreaRow */
/** @typedef {{ rows: AreaRow[], planned: number, logged: number, focusMinutes: number }} WeekSummary */
/** @typedef {{ count: number, minutes: number, busiest: { dayId: DayId, slotIds: SlotId[] } | null }} Interruptions */
/** @typedef {{ task: Task, logged: number }} EstimateOutcome */

/**
 * Planned against logged sessions per area. Planned counts sessions and
 * fixed events linked to the area; logged counts minutes as fractions of
 * the focus length.
 *
 * @param {readonly Area[]} areas
 * @param {Week | undefined} week undefined for a week never opened
 * @param {readonly SessionLog[]} logs
 * @param {LocalDate} monday
 * @param {number} focusMinutes
 * @returns {WeekSummary}
 */
export function summariseWeek(areas, week, logs, monday, focusMinutes) {
  /** @type {Map<AreaId, number>} */
  const planned = new Map();
  for (const entry of Object.values(week?.slots ?? {})) {
    if (entry.kind === 'review' || entry.areaId === null) continue;
    planned.set(entry.areaId, (planned.get(entry.areaId) ?? 0) + 1);
  }

  /** @type {Map<AreaId, number>} */
  const loggedMinutes = new Map();
  for (const log of logsInWeek(logs, monday)) {
    loggedMinutes.set(log.areaId, (loggedMinutes.get(log.areaId) ?? 0) + log.minutes);
  }

  const rows = areas.map((area) => ({
    areaId: area.id,
    planned: planned.get(area.id) ?? 0,
    logged: (loggedMinutes.get(area.id) ?? 0) / focusMinutes,
  }));
  const totalMinutes = [...loggedMinutes.values()].reduce((sum, minutes) => sum + minutes, 0);
  return {
    rows,
    planned: rows.reduce((sum, row) => sum + row.planned, 0),
    logged: totalMinutes / focusMinutes,
    focusMinutes: totalMinutes,
  };
}

/**
 * Sessions stopped early in the week, and the day they clustered on with
 * the slots involved. Unplanned sessions have no slot and do not count
 * towards the busiest day.
 *
 * @param {readonly SessionLog[]} logs
 * @param {LocalDate} monday
 * @returns {Interruptions}
 */
export function summariseInterruptions(logs, monday) {
  const interrupted = logsInWeek(logs, monday).filter((log) => log.outcome === 'interrupted');

  /** @type {Map<DayId, Set<SlotId>>} */
  const slotsByDay = new Map();
  /** @type {Map<DayId, number>} */
  const countByDay = new Map();
  for (const log of interrupted) {
    if (log.slotKey === null) continue;
    const { dayId, slotId } = parseSlotKey(log.slotKey);
    countByDay.set(dayId, (countByDay.get(dayId) ?? 0) + 1);
    slotsByDay.set(dayId, (slotsByDay.get(dayId) ?? new Set()).add(slotId));
  }

  /** @type {DayId | null} */
  let busiestDay = null;
  for (const dayId of DAY_IDS) {
    const count = countByDay.get(dayId) ?? 0;
    if (count > 0 && (busiestDay === null || count > (countByDay.get(busiestDay) ?? 0))) busiestDay = dayId;
  }

  return {
    count: interrupted.length,
    minutes: interrupted.reduce((sum, log) => sum + log.minutes, 0),
    busiest: busiestDay === null
      ? null
      : { dayId: busiestDay, slotIds: SLOT_IDS.filter((slotId) => slotsByDay.get(busiestDay)?.has(slotId)) },
  };
}

/**
 * Tasks finished in the week with the sessions they actually took.
 *
 * @param {readonly Task[]} tasks
 * @param {Map<string, number>} logged sessions per task id
 * @param {LocalDate} monday
 * @returns {EstimateOutcome[]}
 */
export function finishedInWeek(tasks, logged, monday) {
  return tasks
    .filter((task) => task.finishedOn !== null && mondayOf(task.finishedOn) === monday)
    .map((task) => ({ task, logged: logged.get(task.id) ?? 0 }));
}

/**
 * @param {readonly SessionLog[]} logs
 * @param {LocalDate} monday
 * @returns {SessionLog[]}
 */
function logsInWeek(logs, monday) {
  return logs.filter((log) => mondayOf(log.date) === monday);
}
