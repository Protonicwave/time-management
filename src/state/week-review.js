/**
 * @import { AreaRow } from '../domain/review.js'
 * @import { AreaId, LocalDate } from '../domain/types.js'
 */
import { addDays, dayIdOf, mondayOf } from '../domain/calendar.js';

/**
 * What the weekly review says about planned against logged.
 * @typedef {{ kind: 'met' }
 *   | { kind: 'close' }
 *   | { kind: 'short', areaId: AreaId, sessions: number, met: AreaId | null }} Verdict
 */

/**
 * The week the review is about: the review happens on Friday, so until
 * then the latest finished week is the one before.
 *
 * @param {LocalDate} date
 * @returns {LocalDate}
 */
export function reviewWeekOn(date) {
  const dayId = dayIdOf(date);
  return dayId === 'fri' || dayId === null ? mondayOf(date) : addDays(mondayOf(date), -7);
}

/**
 * The largest shortfall of at least one whole session, earlier areas
 * winning ties, with the first area that got all it was planned. A gap
 * under a session is stopping early, not an area going without.
 *
 * @param {readonly AreaRow[]} rows in priority order
 * @returns {Verdict}
 */
export function weekVerdict(rows) {
  /** @type {AreaRow | null} */
  let worst = null;
  for (const row of rows) {
    if (worst === null || row.planned - row.logged > worst.planned - worst.logged) worst = row;
  }
  const gap = worst === null ? 0 : worst.planned - worst.logged;
  if (worst === null || gap <= 0) return { kind: 'met' };
  if (gap < 1) return { kind: 'close' };
  const met = rows.find((row) => row.planned > 0 && row.logged >= row.planned)?.areaId ?? null;
  return { kind: 'short', areaId: worst.areaId, sessions: gap, met };
}
