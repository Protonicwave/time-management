/** @import { DayId, LocalDate, SlotId, SlotKey } from './types.js' */

/** @type {readonly DayId[]} */
export const DAY_IDS = ['mon', 'tue', 'wed', 'thu', 'fri'];

/** @type {readonly SlotId[]} */
export const SLOT_IDS = ['09', '10', '11', '13', '14', '15', '16'];

/** @type {readonly SlotKey[]} */
export const SLOT_KEYS = DAY_IDS.flatMap((dayId) => SLOT_IDS.map((slotId) => slotKey(dayId, slotId)));

/** @type {SlotKey} */
export const REVIEW_SLOT_KEY = 'fri-16';

const MILLISECONDS_PER_DAY = 86_400_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export class InvalidDateError extends Error {
  /** @param {unknown} value */
  constructor(value) {
    super(`expected a calendar date as YYYY-MM-DD, got ${JSON.stringify(value)}`);
    this.name = 'InvalidDateError';
  }
}

/**
 * @param {unknown} value
 * @returns {value is LocalDate}
 */
export function isLocalDate(value) {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  // Date.UTC rolls 2026-02-30 over into March, so a round trip exposes it.
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

/**
 * @param {unknown} value
 * @returns {LocalDate}
 */
export function parseLocalDate(value) {
  if (!isLocalDate(value)) throw new InvalidDateError(value);
  return value;
}

/**
 * The local calendar date of an instant, in the timezone of the process.
 * @param {Date} now
 * @returns {LocalDate}
 */
export function localDateOf(now) {
  return formatParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * Calendar arithmetic runs in UTC so a daylight-saving change, which makes
 * a local day 23 or 25 hours long, cannot shift the result.
 * @param {LocalDate} date
 * @param {number} days
 * @returns {LocalDate}
 */
export function addDays(date, days) {
  const shifted = new Date(toUtcMilliseconds(date) + days * MILLISECONDS_PER_DAY);
  return formatParts(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/**
 * @param {LocalDate} from
 * @param {LocalDate} to
 * @returns {number} negative when to is earlier
 */
export function daysBetween(from, to) {
  return Math.round((toUtcMilliseconds(to) - toUtcMilliseconds(from)) / MILLISECONDS_PER_DAY);
}

/**
 * @param {LocalDate} date
 * @returns {LocalDate}
 */
export function mondayOf(date) {
  const daysSinceMonday = (new Date(toUtcMilliseconds(date)).getUTCDay() + 6) % 7;
  return addDays(date, -daysSinceMonday);
}

/**
 * @param {LocalDate} date
 * @returns {DayId | null} null on Saturday and Sunday
 */
export function dayIdOf(date) {
  const daysSinceMonday = (new Date(toUtcMilliseconds(date)).getUTCDay() + 6) % 7;
  return DAY_IDS[daysSinceMonday] ?? null;
}

/**
 * @param {LocalDate} monday
 * @param {DayId} dayId
 * @returns {LocalDate}
 */
export function dateOfDay(monday, dayId) {
  return addDays(monday, DAY_IDS.indexOf(dayId));
}

/**
 * The first library day strictly after the given date.
 * @param {LocalDate} date
 * @returns {LocalDate}
 */
export function nextLibraryDay(date) {
  let next = addDays(date, 1);
  while (dayIdOf(next) === null) next = addDays(next, 1);
  return next;
}

/**
 * @param {DayId} dayId
 * @param {SlotId} slotId
 * @returns {SlotKey}
 */
export function slotKey(dayId, slotId) {
  return `${dayId}-${slotId}`;
}

/**
 * @param {SlotKey} key
 * @returns {{ dayId: DayId, slotId: SlotId }}
 */
export function parseSlotKey(key) {
  const [dayId, slotId] = /** @type {[DayId, SlotId]} */ (key.split('-'));
  return { dayId, slotId };
}

/**
 * @param {unknown} value
 * @returns {value is SlotKey}
 */
export function isSlotKey(value) {
  return typeof value === 'string' && SLOT_KEYS.includes(/** @type {SlotKey} */ (value));
}

/**
 * @param {LocalDate} date
 * @returns {number}
 */
function toUtcMilliseconds(date) {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(Number(year), Number(month) - 1, Number(day));
}

/**
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @returns {LocalDate}
 */
function formatParts(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
