/**
 * @import { AppState, LocalDate, SessionLog } from '../../domain/types.js'
 * @import { DaySummary, SlotRow, SlotStatus, UnplannedRow } from '../../state/day.js'
 * @import { ViewContext } from '../shell.js'
 */
import { capacityFor } from '../../domain/allocation.js';
import { REVIEW_SLOT_KEY, dayIdOf, daysBetween, localDateOf, mondayOf } from '../../domain/calendar.js';
import { summariseWeek } from '../../domain/review.js';
import {
  LAST_SLOT_HOUR,
  areaName,
  entryTitle,
  firstSessionOfNextDay,
  isClosingTime,
  isFirstRun,
  latestLog,
  nearestDeadlines,
  sessionsToGo,
  slotRows,
  summariseDay,
  taskTitle,
  unplannedRows,
  weekShownOn,
} from '../../state/day.js';
import { isSoon } from '../../state/deadlines.js';
import { editSlot, ensureWeek, noteLog, setTaskFinished, startSession } from '../../state/transitions.js';
import { clock, clockOf, compactMinutes, decimal, duration, h, icon, longDate, plural, shortDate, weekday } from '../dom.js';
import { openUnplannedDialog } from '../unplanned-dialog.js';

const LUNCH_HOUR = 12;
const DEADLINES_SHOWN = 3;

// Interface memory for this page load only. Losing it on reload at worst
// shows a panel again, which is harmless, so it does not belong in the
// saved state.
/** Logs whose completion panel was saved. */
const acknowledged = new Set();
/** Dates closed with "Done for today". */
const closedDays = new Set();
/** Dates whose close panel was opened before closing time. */
const closeOpened = new Set();

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
  const capacity = capacityFor(context.state.settings.recurring);
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
    pageHead(longDate(today), 'No library day. Monday\'s plan is ready when you are.', unplannedButton(context)),
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
  const focusing = state.timer.phase === 'focus';
  const rows = slotRows(state, today);
  const summary = summariseDay(state, today);
  const closing = !focusing && !closedDays.has(today) && (isClosingTime(now, state.settings.focusMinutes) || closeOpened.has(today));

  // The completion panel belongs to the session that has just ended, until
  // it is saved or the next session starts.
  const latest = latestLog(state.logs, today);
  const panelLog = latest && !focusing && latest.note === '' && !acknowledged.has(latest.id) ? latest : null;

  const subtitle = closing
    ? `${plural(summary.logged, 'session')} logged, ${duration(summary.focusMinutes)} of focus.`
    : `${plural(summary.logged, 'session')} logged, ${sessionsToGo(rows)} to go.${dayMarker(state, now)}`;
  /** @param {SlotRow} row */
  const item = (row) => slotItem(context, row, panelLog?.slotKey === row.key ? panelLog : null, today);

  return h('div', {},
    pageHead(longDate(today), subtitle, unplannedButton(context)),
    closing && closePanel(context, today, summary),
    h('div', { class: 'today' },
      h('ol', { class: 'timeline', 'aria-label': 'Today\'s sessions' },
        rows.filter((row) => row.hour < LUNCH_HOUR).map(item),
        h('li', { class: 'lunch' }, h('time', {}, clock(LUNCH_HOUR)), h('span', {}, 'Lunch, away from the desk')),
        rows.filter((row) => row.hour > LUNCH_HOUR).map(item),
        unplannedRows(state, today).map((row) => unplannedItem(context, row, panelLog && row.log?.id === panelLog.id ? panelLog : null, today)),
        closeRow(context, today, closing)),
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
 * @param {SessionLog | null} panelLog
 * @param {LocalDate} today
 */
function slotItem(context, row, panelLog, today) {
  const { state } = context;
  const { entry, status } = row;
  const areaId = entry.kind === 'review' ? null : entry.areaId;
  const classes = ['slot', ...statusClasses(status)];
  if (entry.kind === 'fixed') classes.push('fixed');

  return h('li', { class: classes.join(' '), 'data-area': areaId, ...liveAttributes(status) },
    h('time', {}, clock(row.hour)),
    h('div', {},
      h('div', { class: 'slot-area' },
        areaId && h('span', { class: 'swatch' }),
        areaId ? areaName(state, areaId) : entry.kind === 'review' ? 'Weekly review' : null,
        entry.kind === 'fixed' && h('span', { class: 'fixed-tag' }, 'Fixed')),
      slotTask(context, row)),
    slotMeta(context, row),
    panelLog && completePanel(context, panelLog, today));
}

/**
 * @param {ViewContext} context
 * @param {UnplannedRow} row
 * @param {SessionLog | null} panelLog
 * @param {LocalDate} today
 */
function unplannedItem(context, row, panelLog, today) {
  const { state } = context;
  const title = taskTitle(state, row.taskId);
  return h('li', { class: ['slot', ...statusClasses(row.status)].join(' '), 'data-area': row.areaId, ...liveAttributes(row.status) },
    h('time', {}, clockOf(new Date(row.startedAt))),
    h('div', {},
      h('div', { class: 'slot-area' }, h('span', { class: 'swatch' }), `${areaName(state, row.areaId)}, unplanned`),
      h('div', { class: title === null ? 'slot-task none' : 'slot-task' }, title ?? 'No task')),
    h('div', { class: 'slot-meta' }, statusMeta(row.status)),
    panelLog && completePanel(context, panelLog, today));
}

/**
 * @param {SlotStatus} status
 * @returns {string[]}
 */
function statusClasses(status) {
  if (status.status === 'live') return ['active'];
  return status.status === 'logged' && status.completed ? ['done'] : [];
}

/**
 * The shell's tick fills a live row by updating --progress.
 * @param {SlotStatus} status
 */
function liveAttributes(status) {
  return status.status === 'live' ? { 'data-live-progress': true, style: '--progress: 0%' } : {};
}

/**
 * @param {SlotStatus} status
 * @returns {Node[]}
 */
function statusMeta(status) {
  switch (status.status) {
    case 'live':
      return [h('span', { class: 'countdown', 'data-live-countdown': true })];
    case 'logged':
      return status.completed
        ? [icon('i-check', 'check'), h('span', { class: 'mono' }, compactMinutes(status.minutes))]
        : [h('span', { class: 'mono muted' }, `${compactMinutes(status.minutes)}, stopped`)];
    case 'open':
      return [];
  }
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
  // A slot stopped early can be started again; its logs add up.
  const start = session !== null && state.timer.phase !== 'focus' && !(status.status === 'logged' && status.completed)
    && button('Start', () => context.apply(startSession, session, context.clock()), 'btn small reveal', `start-${row.key}`);

  if (status.status !== 'open') return h('div', { class: 'slot-meta' }, statusMeta(status), status.status === 'logged' && start);
  if (row.key === REVIEW_SLOT_KEY) {
    return h('div', { class: 'slot-meta' }, context.hasView('review') && button('Open review', () => context.navigate('review'), 'btn small reveal'));
  }
  if (row.entry.kind === 'fixed') {
    return session
      ? h('div', { class: 'slot-meta' }, h('span', { class: 'faint' }, 'Counts as 1 session'), start)
      : h('div', { class: 'slot-meta faint' }, 'Not counted');
  }
  return h('div', { class: 'slot-meta' }, start);
}

/**
 * Note and finish for the session that has just ended.
 * @param {ViewContext} context
 * @param {SessionLog} log
 * @param {LocalDate} today
 */
function completePanel(context, log, today) {
  const task = context.state.tasks.find((item) => item.id === log.taskId);
  const note = h('input', { class: 'field', placeholder: 'Note for this session, optional', 'aria-label': 'Session note', maxlength: 2000 });
  const finished = task && task.finishedOn === null ? h('input', { type: 'checkbox' }) : null;

  /** @param {SubmitEvent} event */
  function save(event) {
    event.preventDefault();
    acknowledged.add(log.id);
    const finishedTaskId = finished?.checked && task ? task.id : null;
    context.apply((state) => {
      const noted = noteLog(state, log.id, note.value);
      return finishedTaskId === null ? noted : setTaskFinished(noted, finishedTaskId, today);
    });
  }

  return h('form', { class: 'complete-panel', onsubmit: save },
    h('div', { class: 'row' },
      note,
      finished && h('label', { class: 'inline-check' }, finished, 'Task finished'),
      h('button', { class: 'btn small primary', type: 'submit', 'data-focus-key': `save-${log.id}` }, 'Save')));
}

/**
 * @param {ViewContext} context
 * @param {LocalDate} today
 * @param {DaySummary} summary
 */
function closePanel(context, today, summary) {
  const { state } = context;
  const { date, row } = firstSessionOfNextDay(state, today);
  const session = row?.session ?? null;
  const whose = daysBetween(today, date) === 1 ? 'tomorrow\'s' : `${weekday(date)}'s`;

  const choice = session && h('select', { class: 'field', 'aria-label': `First task for ${weekday(date)}` },
    h('option', { value: '' }, 'No specific task'),
    state.tasks
      .filter((task) => task.areaId === session.areaId && (task.finishedOn === null || task.id === session.taskId))
      .map((task) => h('option', { value: task.id, selected: task.id === session.taskId }, task.title)));

  function done() {
    const taskId = choice?.value || null;
    if (row && session && taskId !== session.taskId) {
      context.apply(editSlot, mondayOf(date), row.key, { kind: 'session', areaId: session.areaId, taskId });
    }
    closedDays.add(today);
    context.refresh();
  }

  return h('div', { class: 'state-panel' },
    h('h2', {}, 'Close the day'),
    h('p', {}, row
      ? `Pick ${whose} first task now, so ${clock(row.hour)} starts with work instead of a decision.`
      : `${weekday(date)} has no sessions planned, so there is nothing to pick.`),
    h('div', { class: 'summary-line' },
      fact(`${summary.logged} / ${summary.planned}`, 'Sessions'),
      fact(String(summary.stopped), 'Stopped early'),
      fact(String(summary.finished), 'Tasks finished')),
    h('div', { class: 'row' },
      row && session && h('span', { class: 'muted' }, `${weekday(date)} ${clock(row.hour)}, ${areaName(state, session.areaId)}`),
      choice,
      button('Done for today', done, 'btn primary', 'close-done')));
}

/**
 * @param {ViewContext} context
 * @param {LocalDate} today
 * @param {boolean} closing
 */
function closeRow(context, today, closing) {
  const { state } = context;
  const closed = closedDays.has(today);
  const canOpen = !closing && !closed && state.timer.phase !== 'focus';
  return h('li', { class: 'close-row' },
    h('time', {}, clock(LAST_SLOT_HOUR, state.settings.focusMinutes)),
    h('span', {}, closed ? 'Day closed' : 'Close the day'),
    canOpen && button('Close early', () => {
      closeOpened.add(today);
      context.refresh();
    }, 'btn small quiet'));
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
        context.hasView('deadlines') && h('a', { href: '#deadlines', class: 'muted', 'data-focus-key': 'deadlines-all' }, 'All')),
      deadlines.length === 0
        ? h('p', { class: 'empty' }, 'Add deadlines and the nearest three show here.')
        : h('ul', { class: 'mini-list' }, deadlines.map((deadline) => {
          const days = daysBetween(today, deadline.date);
          return h('li', {},
            h('span', {}, deadline.title),
            h('span', { class: isSoon(days) ? 'days-left soon' : 'days-left' }, `${days} d`),
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

/** @param {ViewContext} context */
function unplannedButton(context) {
  if (context.state.timer.phase === 'focus') return null;
  return button('Unplanned session', () => openUnplannedDialog({ state: context.state, apply: context.apply, clock: context.clock }), 'btn', 'unplanned');
}

/**
 * @param {string} title
 * @param {string} subtitle
 * @param {Node | null} [action]
 */
function pageHead(title, subtitle, action = null) {
  return h('header', { class: 'page-head' },
    h('div', {}, h('h1', {}, title), h('p', {}, subtitle)),
    action && h('div', { class: 'head-actions' }, action));
}

/**
 * @param {string} value
 * @param {string} label
 */
function fact(value, label) {
  return h('div', {}, h('span', { class: 'mono' }, value), h('span', { class: 'muted' }, label));
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
