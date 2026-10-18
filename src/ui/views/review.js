/**
 * @import { AppState, LocalDate } from '../../domain/types.js'
 * @import { Interruptions, WeekSummary } from '../../domain/review.js'
 * @import { ViewContext } from '../shell.js'
 */
import { addDays, dateOfDay, daysBetween, localDateOf, mondayOf } from '../../domain/calendar.js';
import { loggedSessionsByTask } from '../../domain/estimates.js';
import { finishedInWeek, summariseInterruptions, summariseWeek } from '../../domain/review.js';
import { areaName } from '../../state/day.js';
import { reviewWeekOn, weekVerdict } from '../../state/week-review.js';
import { clock, dayMonth, duration, h, icon, plural, tenths, weekday } from '../dom.js';

const MINUS = '−';

// The week on screen is page-load memory; null follows the week due for review.
/** @type {LocalDate | null} */
let shownMonday = null;

/**
 * @param {ViewContext} context
 * @returns {Node}
 */
export function renderReview(context) {
  const { state } = context;
  const today = localDateOf(context.now);
  const monday = shownMonday ?? reviewWeekOn(today);
  const thisMonday = mondayOf(today);
  /** @param {LocalDate | null} next */
  const show = (next) => {
    shownMonday = next;
    context.refresh();
  };

  const { focusMinutes } = state.settings;
  const summary = summariseWeek(state.settings.areas, state.weeks[monday], state.logs, monday, focusMinutes);
  const subtitle = monday === reviewWeekOn(today)
    ? 'Friday review. Fifteen minutes, then plan next week.'
    : monday === thisMonday ? 'This week so far.' : 'An earlier week.';

  return h('div', {},
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, `Week of ${dayMonth(monday)}`), h('p', {}, subtitle)),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn quiet', type: 'button', 'aria-label': 'Previous week', 'data-focus-key': 'review-prev', onclick: () => show(addDays(monday, -7)) },
          icon('i-left', 'icon')),
        // Later weeks have nothing to review yet.
        h('button', {
          class: 'btn quiet',
          type: 'button',
          'aria-label': 'Next week',
          'data-focus-key': 'review-next',
          disabled: monday >= thisMonday,
          onclick: () => show(addDays(monday, 7)),
        }, icon('i-right', 'icon')))),
    summary.planned === 0 && summary.focusMinutes === 0
      ? h('p', { class: 'empty' }, 'Nothing was planned or logged in this week. Use the arrows to find a week you worked.')
      : weekBody(context, monday, summary),
    backup(context, today));
}

/**
 * @param {ViewContext} context
 * @param {LocalDate} monday
 * @param {WeekSummary} summary
 */
function weekBody(context, monday, summary) {
  const { state } = context;
  const scale = Math.max(...summary.rows.flatMap((row) => [row.planned, row.logged]));
  /** @param {number} value */
  const width = (value) => `width: ${scale === 0 ? 0 : ((value / scale) * 100).toFixed(1)}%`;

  return [
    h('p', { class: 'review-summary' }, summarySentences(state, summary)),
    h('table', { class: 'rtable' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Area'), h('th', { class: 'r' }, 'Planned'), h('th', { class: 'r' }, 'Logged'), h('th', { class: 'r' }, 'Difference'),
        h('th', { class: 'barcell' }, h('span', { class: 'visually-hidden' }, 'Planned and logged as bars')))),
      h('tbody', {}, summary.rows.map((row) => h('tr', { 'data-area': row.areaId },
        h('td', {}, h('span', { class: 'name' }, h('span', { class: 'swatch' }), areaName(state, row.areaId))),
        h('td', { class: 'r' }, String(row.planned)),
        h('td', { class: 'r' }, row.logged.toFixed(1)),
        differenceCell(row.logged - row.planned),
        h('td', { class: 'barcell', 'aria-hidden': 'true' },
          h('div', { class: 'bullet' }, h('span', { class: 'plan', style: width(row.planned) }), h('span', { class: 'done', style: width(row.logged) })))))),
      h('tfoot', {}, h('tr', {},
        h('td', {}, 'Total'),
        h('td', { class: 'r' }, String(summary.planned)),
        h('td', { class: 'r' }, summary.logged.toFixed(1)),
        differenceCell(summary.logged - summary.planned),
        h('td', { class: 'barcell' })))),
    h('div', { class: 'legend', 'aria-hidden': 'true' }, h('span', {}, h('i'), 'Planned'), h('span', {}, h('i', { class: 'd' }), 'Logged')),
    h('div', { class: 'two-col' },
      interruptionsSection(monday, summariseInterruptions(state.logs, monday)),
      estimatesSection(state, monday)),
  ];
}

/**
 * @param {AppState} state
 * @param {WeekSummary} summary
 * @returns {string}
 */
function summarySentences(state, summary) {
  const opening = `You logged ${tenths(summary.logged)} of ${plural(summary.planned, 'planned session')}, about ${duration(summary.focusMinutes)} of focus.`;
  const verdict = weekVerdict(summary.rows);
  switch (verdict.kind) {
    case 'met':
      return `${opening} Every area got the sessions it was planned.`;
    case 'close':
      return `${opening} No area ran a full session short.`;
    case 'short': {
      const sessions = tenths(verdict.sessions);
      const short = `${areaName(state, verdict.areaId)} ran ${sessions} ${sessions === '1' ? 'session' : 'sessions'} short.`;
      return verdict.met === null ? `${opening} ${short}` : `${opening} ${areaName(state, verdict.met)} got everything it was given. ${short}`;
    }
  }
}

/**
 * Rounded first, so a gap that shows as 0.0 is neither signed nor red.
 * @param {number} difference
 */
function differenceCell(difference) {
  const rounded = Math.round(difference * 10) / 10;
  if (rounded === 0) return h('td', { class: 'r' }, '0');
  return rounded > 0
    ? h('td', { class: 'r' }, `+${rounded.toFixed(1)}`)
    : h('td', { class: 'r neg' }, `${MINUS}${Math.abs(rounded).toFixed(1)}`);
}

/**
 * @param {LocalDate} monday
 * @param {Interruptions} interruptions
 */
function interruptionsSection(monday, interruptions) {
  const { busiest } = interruptions;
  const times = busiest?.slotIds.map((slotId) => clock(Number(slotId))) ?? [];
  const when = times.length <= 1 ? times.join('') : `${times.slice(0, -1).join(', ')} and ${times.at(-1)}`;
  return h('section', {},
    h('div', { class: 'section-title' }, h('h2', {}, 'Interruptions')),
    h('ul', { class: 'facts' },
      h('li', {}, h('span', {}, 'Sessions stopped early'), h('span', { class: 'mono' }, String(interruptions.count))),
      h('li', {}, h('span', {}, 'Minutes in those sessions'), h('span', { class: 'mono' }, String(interruptions.minutes))),
      busiest && h('li', {}, h('span', {}, 'Most often'), h('span', { class: 'muted' }, `${weekday(dateOfDay(monday, busiest.dayId))}, ${when}`))));
}

/**
 * @param {AppState} state
 * @param {LocalDate} monday
 */
function estimatesSection(state, monday) {
  const finished = finishedInWeek(state.tasks, loggedSessionsByTask(state.logs, state.settings.focusMinutes), monday);
  return h('section', {},
    h('div', { class: 'section-title' }, h('h2', {}, 'Estimates'), h('span', { class: 'muted' }, 'finished this week')),
    finished.length === 0
      ? h('p', { class: 'empty' }, 'No tasks were finished this week. Tick tasks off as you finish them and their estimates are compared here.')
      : h('ul', { class: 'facts' }, finished.map(({ task, logged }) => h('li', {},
        h('span', {}, task.title),
        h('span', { class: 'mono', 'aria-label': `estimated ${task.estimate}, took ${tenths(logged)}` },
          `${task.estimate} → ${tenths(logged)}`)))));
}

/**
 * The weekly reminder to export, since browser data can go without warning.
 * @param {ViewContext} context
 * @param {LocalDate} today
 */
function backup(context, today) {
  const { lastExportOn } = context.state;
  const age = lastExportOn === null ? null : daysBetween(lastExportOn, today);
  const last = lastExportOn === null || age === null
    ? 'No backup exported yet.'
    : age === 0 ? 'Last backup today.' : `Last backup ${dayMonth(lastExportOn)}, ${plural(age, 'day')} ago.`;
  const mirror = context.mirror.status() === 'on' ? ' The backup file is also rewritten after every change.' : '';
  return h('div', { class: 'backup' },
    h('span', {}, `${last} Browser data can be cleared without warning.${mirror}`),
    h('button', { class: 'btn primary', type: 'button', 'data-focus-key': 'review-export', onclick: context.exportBackup }, 'Export backup'));
}
