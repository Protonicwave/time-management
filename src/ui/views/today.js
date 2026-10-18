/**
 * @import { AppState, LocalDate } from '../../domain/types.js'
 * @import { SlotRow } from '../../state/day.js'
 * @import { ViewContext } from '../shell.js'
 */
import { REVIEW_SLOT_KEY, SLOT_KEYS, dayIdOf, daysBetween, localDateOf, mondayOf } from '../../domain/calendar.js';
import { summariseWeek } from '../../domain/review.js';
import { areaName, entryTitle, isFirstRun, logsOn, nearestDeadlines, sessionsToGo, slotRows, weekShownOn } from '../../state/day.js';
import { ensureWeek, startSession } from '../../state/transitions.js';
import { clock, clockOf, compactMinutes, decimal, h, icon, longDate, plural, shortDate } from '../dom.js';

const LUNCH_HOUR = 12;
const DEADLINES_SHOWN = 3;
const SOON_DAYS = 7;

/**
 * @param {ViewContext} context
 * @returns {Node}
 */
export function renderToday(context) {
  const today = localDateOf(context.now);
  if (isFirstRun(context.state)) return firstRun(context, today);
  if (dayIdOf(today) === null) return weekend(context, today);
  return libraryDay(context, today);
}

/**
 * @param {ViewContext} context
 * @param {LocalDate} today
 */
function firstRun(context, today) {
  const capacity = SLOT_KEYS.length - 1;
  return h('div', {},
    pageHead('Set up your library week', 'Three things and the first week plans itself. You can change any of it later.'),
    h('div', { class: 'state-panel' },
      h('h2', {}, 'Before you start'),
      h('p', {}, `The plan gives ${capacity} sessions a week to your areas, with projects first. Fixed events go in before anything is generated.`),
      h('ol', { class: 'steps' },
        step(1, ['Name this semester\'s three modules'], button('Name modules', () => context.navigate('settings'))),
        step(2, ['Add weekly fixed events, such as the group meeting'], button('Add events', () => context.navigate('settings'))),
        step(3, ['Generate the first week ', h('span', { class: 'muted' }, 'from the default allocation')],
          button('Generate week', () => context.apply(ensureWeek, weekShownOn(today)), 'btn small primary')))));
}

/**
 * @param {ViewContext} context
 * @param {LocalDate} today
 */
function weekend(context, today) {
  const { state } = context;
  const monday = weekShownOn(today);
  const first = slotRows(state, monday).find((row) => row.session !== null);
  return h('div', {},
    pageHead(longDate(today), 'No library day. Monday\'s plan is ready when you are.'),
    h('div', { class: 'state-panel' },
      h('h2', {}, longDate(monday)),
      h('p', {}, first ? startsWith(state, first) : 'Nothing is planned yet.'),
      (context.hasView('week') || context.hasView('review')) && h('div', { class: 'row' },
        context.hasView('week') && button('Open next week', () => context.navigate('week'), 'btn'),
        context.hasView('review') && button('Review this week', () => context.navigate('review'), 'btn quiet'))));
}

/**
 * @param {AppState} state
 * @param {SlotRow} row
 * @returns {string}
 */
function startsWith(state, row) {
  const { entry } = row;
  if (entry.kind === 'session') {
    const area = areaName(state, entry.areaId);
    return entry.taskId === null
      ? `Starts with ${area} at ${clock(row.hour)}, with no task chosen yet.`
      : `Starts with ${area} at ${clock(row.hour)}: ${entryTitle(state, entry)}.`;
  }
  return `Starts with ${entryTitle(state, entry)} at ${clock(row.hour)}.`;
}

/**
 * @param {ViewContext} context
 * @param {LocalDate} today
 */
function libraryDay(context, today) {
  const { state, now } = context;
  const rows = slotRows(state, today);
  const logged = logsOn(state.logs, today).length;
  return h('div', {},
    pageHead(longDate(today), `${plural(logged, 'session')} logged, ${sessionsToGo(rows)} to go.${dayMarker(state, now)}`),
    h('div', { class: 'today' },
      h('ol', { class: 'timeline', 'aria-label': 'Today\'s sessions' },
        rows.filter((row) => row.hour < LUNCH_HOUR).map((row) => slotItem(context, row)),
        h('li', { class: 'lunch' }, h('time', {}, clock(LUNCH_HOUR)), h('span', {}, 'Lunch, away from the desk')),
        rows.filter((row) => row.hour > LUNCH_HOUR).map((row) => slotItem(context, row)),
        h('li', { class: 'close-row' }, h('time', {}, clock(16, state.settings.focusMinutes)), h('span', {}, 'Close the day'))),
      aside(context, today)));
}

/**
 * The next fixed point of the day after the counts.
 * @param {AppState} state
 * @param {Date} now
 * @returns {string}
 */
function dayMarker(state, now) {
  const { timer } = state;
  if (timer.phase === 'break') {
    return ` Break until ${clockOf(new Date(Date.parse(timer.startedAt) + timer.breakMinutes * 60_000))}.`;
  }
  return now.getHours() < LUNCH_HOUR ? ` Lunch at ${clock(LUNCH_HOUR)}.` : '';
}

/**
 * @param {ViewContext} context
 * @param {SlotRow} row
 */
function slotItem(context, row) {
  const { state } = context;
  const { entry, status } = row;
  const classes = ['slot'];
  if (status.status === 'logged' && status.completed) classes.push('done');
  if (status.status === 'live') classes.push('active');
  if (entry.kind === 'fixed') classes.push('fixed');
  const areaId = entry.kind === 'review' ? null : entry.areaId;

  return h('li', {
    class: classes.join(' '),
    'data-area': areaId,
    'data-live-progress': status.status === 'live',
    style: status.status === 'live' ? '--progress: 0%' : null,
  },
  h('time', {}, clock(row.hour)),
  h('div', {},
    h('div', { class: 'slot-area' },
      areaId && h('span', { class: 'swatch' }),
      areaId ? areaName(state, areaId) : entry.kind === 'review' ? 'Weekly review' : null,
      entry.kind === 'fixed' && h('span', { class: 'fixed-tag' }, 'Fixed')),
    slotTask(context, row)),
  slotMeta(context, row));
}

/**
 * @param {ViewContext} context
 * @param {SlotRow} row
 */
function slotTask(context, row) {
  const { entry } = row;
  if (entry.kind === 'review') return h('div', { class: 'slot-task' }, 'Fifteen minutes on how the week went, then plan the next.');
  if (entry.kind === 'session' && entry.taskId === null) {
    return h('div', { class: 'slot-task none' }, entry.areaId === 'buffer' ? 'Overflow from earlier, or catch up' : 'No task yet');
  }
  return h('div', { class: 'slot-task' }, entryTitle(context.state, entry));
}

/**
 * @param {ViewContext} context
 * @param {SlotRow} row
 */
function slotMeta(context, row) {
  const { state } = context;
  const { status, session } = row;
  const canStart = session !== null && state.timer.phase !== 'focus';
  const start = canStart && button('Start', () => context.apply(startSession, session, context.clock()), 'btn small reveal', `start-${row.key}`);

  switch (status.status) {
    case 'live':
      return h('div', { class: 'slot-meta' }, h('span', { class: 'countdown', 'data-live-countdown': true }));
    case 'logged':
      return status.completed
        ? h('div', { class: 'slot-meta' }, icon('i-check', 'check'), h('span', { class: 'mono' }, compactMinutes(status.minutes)))
        : h('div', { class: 'slot-meta' }, h('span', { class: 'mono muted' }, `${compactMinutes(status.minutes)}, stopped`), start);
    case 'open':
      if (row.key === REVIEW_SLOT_KEY) {
        return h('div', { class: 'slot-meta' }, context.hasView('review') && button('Open review', () => context.navigate('review'), 'btn small reveal'));
      }
      if (row.entry.kind === 'fixed') {
        return h('div', { class: 'slot-meta faint' }, session ? 'Counts as 1 session' : 'Not counted', start);
      }
      return h('div', { class: 'slot-meta' }, start);
  }
}

/**
 * @param {ViewContext} context
 * @param {LocalDate} today
 */
function aside(context, today) {
  const { state } = context;
  const monday = mondayOf(today);
  const summary = summariseWeek(state.settings.areas, state.weeks[monday], state.logs, monday, state.settings.focusMinutes);
  const deadlines = nearestDeadlines(state.deadlines, today, DEADLINES_SHOWN);

  return h('div', { class: 'aside' },
    h('section', {},
      h('div', { class: 'section-title' },
        h('h2', {}, 'Deadlines'),
        context.hasView('deadlines') && h('a', { href: '#deadlines', class: 'muted' }, 'All')),
      deadlines.length === 0
        ? h('p', { class: 'empty' }, 'Add deadlines and the nearest three show here.')
        : h('ul', { class: 'mini-list' }, deadlines.map((deadline) => {
          const days = daysBetween(today, deadline.date);
          return h('li', {},
            h('span', {}, deadline.title),
            h('span', { class: days <= SOON_DAYS ? 'days-left soon' : 'days-left' }, `${days} d`),
            h('span', { class: 'sub', 'data-area': deadline.areaId },
              h('span', { class: 'swatch' }), `${areaName(state, deadline.areaId)}, ${shortDate(deadline.date)}`));
        }))),
    h('section', {},
      h('div', { class: 'section-title' }, h('h2', {}, 'This week'), h('span', { class: 'muted' }, 'logged of planned')),
      h('div', { class: 'meters' }, summary.rows
        .filter((row) => row.areaId !== 'buffer')
        .map((row) => h('div', { class: 'meter', 'data-area': row.areaId },
          h('span', { class: 'name' }, h('span', { class: 'swatch' }), areaName(state, row.areaId)),
          h('span', { class: 'count' }, `${decimal(row.logged)} / ${row.planned}`),
          h('span', { class: 'track' }, h('span', { style: `width: ${row.planned === 0 ? 0 : Math.min(100, (row.logged / row.planned) * 100).toFixed(0)}%` })))))));
}

/**
 * @param {string} title
 * @param {string} subtitle
 */
function pageHead(title, subtitle) {
  return h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, title), h('p', {}, subtitle)));
}

/**
 * @param {number} number
 * @param {(Node | string)[]} text
 * @param {Node} action
 */
function step(number, text, action) {
  return h('li', {}, h('span', { class: 'n' }, String(number)), h('span', {}, text), action);
}

/**
 * @param {string} label
 * @param {() => void} run
 * @param {string} [className]
 * @param {string} [focusKey] keeps keyboard focus on this button across redraws
 */
function button(label, run, className = 'btn small', focusKey) {
  return h('button', { class: className, type: 'button', 'data-focus-key': focusKey ?? label, onclick: run }, label);
}
