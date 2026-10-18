/** @import { Deadline, LocalDate } from '../domain/types.js' */
import { daysBetween } from '../domain/calendar.js';

const NEXT_DAYS = 14;
const SOON_DAYS = 7;

/** @typedef {{ deadline: Deadline, days: number }} DatedDeadline days from today, negative once past */

/**
 * @param {readonly Deadline[]} deadlines
 * @param {LocalDate} today
 * @returns {{ next: DatedDeadline[], later: DatedDeadline[], past: DatedDeadline[] }}
 *   next and later soonest first; past most recent first
 */
export function groupDeadlines(deadlines, today) {
  // Array.prototype.sort is stable, so equal dates keep the order added.
  const dated = deadlines
    .map((deadline) => ({ deadline, days: daysBetween(today, deadline.date) }))
    .sort((a, b) => a.days - b.days);
  return {
    next: dated.filter((item) => item.days >= 0 && item.days <= NEXT_DAYS),
    later: dated.filter((item) => item.days > NEXT_DAYS),
    past: dated.filter((item) => item.days < 0).reverse(),
  };
}

/**
 * Close enough to be shown with weight.
 * @param {number} days
 * @returns {boolean}
 */
export function isSoon(days) {
  return days >= 0 && days <= SOON_DAYS;
}
