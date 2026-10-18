/** @import { LocalDate } from '../domain/types.js' */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** @typedef {string | number | boolean | null | undefined | ((event: any) => void)} Prop */
/** @typedef {Node | string | null | undefined | false} Child */

/**
 * Builds an element. Strings become text nodes, so user text is never
 * parsed as markup. Props starting with "on" are listeners; true sets an
 * empty attribute; null, undefined and false are skipped.
 *
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, Prop>} [props]
 * @param {...(Child | Child[])} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === 'function') element.addEventListener(name.slice(2), value);
    else element.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) element.append(child);
  }
  return element;
}

/**
 * @param {string} id symbol id in the sprite in index.html
 * @param {string} className
 * @returns {SVGSVGElement}
 */
export function icon(id, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

/**
 * @param {number} hour
 * @param {number} [minute]
 * @returns {string} as 09:00
 */
export function clock(hour, minute = 0) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * @param {Date} instant
 * @returns {string} local time as 09:00
 */
export function clockOf(instant) {
  return clock(instant.getHours(), instant.getMinutes());
}

/**
 * @param {number} seconds
 * @returns {string} as 17:42
 */
export function countdown(seconds) {
  return clock(Math.floor(seconds / 60), seconds % 60);
}

/**
 * For mono columns.
 * @param {number} minutes
 * @returns {string} as 50 min
 */
export function compactMinutes(minutes) {
  return `${minutes} min`;
}

/**
 * For running text.
 * @param {number} minutes
 * @returns {string} as 5 hours 41 minutes
 */
export function duration(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return plural(rest, 'minute');
  return rest === 0 ? plural(hours, 'hour') : `${plural(hours, 'hour')} ${plural(rest, 'minute')}`;
}

/**
 * @param {number} count
 * @param {string} noun singular, made plural with an s
 * @returns {string} as 1 session or 6 sessions
 */
export function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * @param {LocalDate} date
 * @returns {string} as Tuesday 20 October
 */
export function longDate(date) {
  const parsed = parse(date);
  return `${WEEKDAYS[parsed.getDay()]} ${parsed.getDate()} ${MONTHS[parsed.getMonth()]}`;
}

/**
 * @param {LocalDate} date
 * @returns {string} as Tue 27 Oct
 */
export function shortDate(date) {
  const parsed = parse(date);
  return `${WEEKDAYS[parsed.getDay()]?.slice(0, 3)} ${parsed.getDate()} ${MONTHS[parsed.getMonth()]?.slice(0, 3)}`;
}

/**
 * @param {LocalDate} date
 * @returns {string} as 19 Oct
 */
export function shortDayMonth(date) {
  const parsed = parse(date);
  return `${parsed.getDate()} ${MONTHS[parsed.getMonth()]?.slice(0, 3)}`;
}

/**
 * Logged sessions are fractional when a session was stopped early.
 * @param {number} value
 * @returns {string} as 5 or 29.5
 */
export function decimal(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * @param {LocalDate} date
 * @returns {string} as Tuesday
 */
export function weekday(date) {
  return /** @type {string} */ (WEEKDAYS[parse(date).getDay()]);
}

/**
 * @param {LocalDate} date
 * @returns {string} as 19 October
 */
export function dayMonth(date) {
  const parsed = parse(date);
  return `${parsed.getDate()} ${MONTHS[parsed.getMonth()]}`;
}

/**
 * @param {LocalDate} monday
 * @returns {string} as 19 to 23 October, or 28 September to 2 October
 */
export function weekRange(monday) {
  const start = parse(monday);
  const end = parse(monday);
  end.setDate(end.getDate() + 4);
  return start.getMonth() === end.getMonth()
    ? `${start.getDate()} to ${end.getDate()} ${MONTHS[end.getMonth()]}`
    : `${start.getDate()} ${MONTHS[start.getMonth()]} to ${end.getDate()} ${MONTHS[end.getMonth()]}`;
}

/**
 * @param {LocalDate} date
 * @returns {Date} local midnight
 */
function parse(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Number(year), Number(month) - 1, Number(day));
}
