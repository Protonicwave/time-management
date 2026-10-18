/**
 * @import { AppState, AreaId, LocalDate, SessionEntry, FixedEntry, SlotKey, Week } from '../../domain/types.js'
 * @import { SlotRow } from '../../state/day.js'
 * @import { ViewContext } from '../shell.js'
 */
import { DAY_IDS, REVIEW_SLOT_KEY, addDays, dateOfDay, localDateOf, mondayOf } from '../../domain/calendar.js';
import { summariseWeek } from '../../domain/review.js';
import { SchemaError } from '../../domain/schema.js';
import { areaName, entryTitle, isFirstRun, slotRows, weekShownOn } from '../../state/day.js';
import { editSlot, ensureWeek, regenerateWeek } from '../../state/transitions.js';
import { clock, compactMinutes, h, icon, plural, weekRange, weekday } from '../dom.js';

const LUNCH_HOUR = 12;

// The week on screen is page-load memory; null follows the week Today is
// about, so the view moves on by itself when the week turns.
/** @type {LocalDate | null} */
let shownMonday = null;

/**
 * @param {ViewContext} context
 * @returns {Node}
 */
export function renderWeek(context) {
  const { state } = context;
  const today = localDateOf(context.now);
  const monday = shownMonday ?? weekShownOn(today);
  /** @param {LocalDate | null} next */
  const show = (next) => {
    shownMonday = next;
    context.refresh();
  };

  // A past week that was never opened has no plan to show; a future one
  // is previewed as ensureWeek would create it.
  const isPast = monday < mondayOf(today);
  const week = state.weeks[monday] ?? (isPast ? undefined : ensureWeek(state, monday).weeks[monday]);

  const actions = h('div', { class: 'head-actions' },
    h('button', { class: 'btn quiet', type: 'button', 'aria-label': 'Previous week', 'data-focus-key': 'week-prev', onclick: () => show(addDays(monday, -7)) },
      icon('i-left', 'icon')),
    h('button', { class: 'btn', type: 'button', 'data-focus-key': 'week-this', onclick: () => show(null) }, 'This week'),
    h('button', { class: 'btn quiet', type: 'button', 'aria-label': 'Next week', 'data-focus-key': 'week-next', onclick: () => show(addDays(monday, 7)) },
      icon('i-right', 'icon')),
    week && !isPast && !isFirstRun(state) && h('button', {
      class: 'btn',
      type: 'button',
      'data-focus-key': 'week-regenerate',
      onclick: () => {
        if (confirm(`Replan the sessions of ${weekRange(monday)} from your allocation? Fixed events stay; tasks chosen for sessions are cleared.`)) {
          context.apply(regenerateWeek, monday);
        }
      },
    }, 'Regenerate'));

  if (isFirstRun(state)) {
    return h('div', {},
      pageHead(weekRange(monday), 'No week is planned yet.', actions),
      h('div', { class: 'state-panel' },
        h('h2', {}, 'Plan your first week'),
        h('p', {}, 'Generate this week from your allocation, then click any slot to change it.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => context.apply(ensureWeek, weekShownOn(today)) }, 'Generate week'))));
  }
  if (!week) {
    return h('div', {},
      pageHead(weekRange(monday), 'This week was not planned in Logbook.', actions),
      h('p', { class: 'empty' }, 'Use the arrows to go back to a week you planned, or This week to return.'));
  }

  const summary = summariseWeek(state.settings.areas, week, state.logs, monday, state.settings.focusMinutes);
  const fromFixed = Object.values(week.slots).filter((entry) => entry.kind === 'fixed' && entry.areaId !== null).length;
  const stored = state.weeks[monday] !== undefined;

  return h('div', {},
    pageHead(weekRange(monday), stored ? 'Generated from your allocation. Click any slot to change it.' : 'A preview from your allocation. It is saved when you change a slot or the week begins.', actions),
    h('div', { class: 'alloc' }, state.settings.areas.map((area) => {
      const planned = summary.rows.find((row) => row.areaId === area.id)?.planned ?? 0;
      return h('span', { 'data-area': area.id },
        h('i', { class: 'swatch' }),
        area.name,
        h('b', { class: planned < area.target ? 'short' : null, title: `${planned} planned of a target of ${area.target}` }, `${planned}/${area.target}`));
    })),
    h('div', { class: 'week-scroll' }, grid(context, monday, today)),
    h('div', { class: 'week-foot' },
      h('span', {}, `${plural(summary.planned, 'session')} planned.${fromFixed > 0 ? ` ${fromFixed} counted from ${fromFixed === 1 ? 'a fixed event' : 'fixed events'}.` : ''}`),
      h('span', {}, 'Dashed outline is a fixed event. A tick is a logged session.')));
}

/**
 * @param {ViewContext} context
 * @param {LocalDate} monday
 * @param {LocalDate} today
 */
function grid(context, monday, today) {
  const days = DAY_IDS.map((dayId) => {
    const date = dateOfDay(monday, dayId);
    return { date, rows: slotRows(context.state, date) };
  });
  const hours = days[0]?.rows.map((row) => row.hour) ?? [];

  return h('div', { class: 'week' },
    h('div'),
    days.map(({ date }) => h('div', { class: date === today ? 'dh today' : 'dh', 'aria-current': date === today ? 'date' : null },
      h('b', {}, weekday(date).slice(0, 3)), h('span', { class: 'mono' }, String(Number(date.slice(8)))))),
    hours.flatMap((hour, index) => [
      hour > LUNCH_HOUR && (hours[index - 1] ?? 0) < LUNCH_HOUR && h('div', { class: 'lunch-gap' }, h('span', { class: 'mono' }, clock(LUNCH_HOUR)), 'Lunch'),
      h('div', { class: 'tm' }, clock(hour)),
      ...days.map(({ date, rows }) => {
        const row = rows[index];
        return row && cell(context, monday, date, row);
      }),
    ]));
}

/**
 * @param {ViewContext} context
 * @param {LocalDate} monday
 * @param {LocalDate} date
 * @param {SlotRow} row
 */
function cell(context, monday, date, row) {
  const { state } = context;
  const { entry, status } = row;
  const when = `${weekday(date)} ${clock(row.hour)}`;
  const classes = ['cell'];
  if (entry.kind === 'fixed') classes.push('fixed');
  if (entry.kind === 'review') classes.push('review');
  if (status.status === 'logged') classes.push('logged');
  if (status.status === 'live') classes.push('now');

  const areaId = entry.kind === 'review' ? null : entry.areaId;
  const label = entry.kind === 'review'
    ? 'Fixed'
    : entry.kind === 'fixed'
      ? (areaId ? `${areaName(state, areaId)}, fixed` : 'Fixed, not counted')
      : areaName(state, entry.areaId);
  const noTask = entry.kind === 'session' && entry.taskId === null;

  const open = entry.kind === 'review'
    ? (context.hasView('review') ? () => context.navigate('review') : null)
    : () => openSlotDialog(context, monday, row.key, when);

  return h('button', {
    type: 'button',
    class: classes.join(' '),
    'data-area': areaId,
    'data-focus-key': `cell-${row.key}`,
    'aria-label': `${when}: ${label}, ${noTask ? 'no task yet' : entryTitle(state, entry)}`,
    disabled: open === null,
    onclick: open,
  },
  h('span', { class: 'a' }, areaId && h('i', { class: 'swatch' }), label),
  h('span', { class: noTask ? 't none' : 't' }, noTask ? 'No task yet' : entryTitle(state, entry)),
  status.status === 'logged' && (status.completed
    ? icon('i-check', 'tick')
    : h('span', { class: 'stopped' }, `${compactMinutes(status.minutes)}, stopped`)));
}

/**
 * Edits one slot of one week. The dialog sits outside the view, so a
 * redraw while it is open cannot remove it.
 *
 * @param {ViewContext} context
 * @param {LocalDate} monday
 * @param {SlotKey} key
 * @param {string} when as Wednesday 14:00
 */
function openSlotDialog(context, monday, key, when) {
  const { state } = context;
  if (key === REVIEW_SLOT_KEY) return;
  const current = /** @type {Week} */ (ensureWeek(state, monday).weeks[monday]).slots[key];
  if (current.kind === 'review') return;
  let kind = current.kind;

  /** @param {boolean} unlinked offers "not counted" first */
  const areaSelect = (unlinked) => h('select', { class: 'field' },
    unlinked && h('option', { value: '' }, 'Not counted towards an area'),
    state.settings.areas.map((area) => h('option', { value: area.id, selected: area.id === current.areaId }, area.name)));

  const sessionArea = areaSelect(false);
  const task = h('select', { class: 'field' });
  const fillTasks = () => task.replaceChildren(
    h('option', { value: '' }, 'No specific task'),
    ...state.tasks
      // A finished task already in the slot stays selectable, so saving does not drop it.
      .filter((item) => item.areaId === sessionArea.value && (item.finishedOn === null || (current.kind === 'session' && item.id === current.taskId)))
      .map((item) => h('option', { value: item.id, selected: current.kind === 'session' && item.id === current.taskId }, item.title)));
  sessionArea.addEventListener('change', fillTasks);
  fillTasks();

  const label = h('input', { class: 'field', maxlength: 80, value: current.kind === 'fixed' ? current.label : '', placeholder: 'Group meeting' });
  const fixedArea = areaSelect(true);
  if (current.kind !== 'fixed' || current.areaId === null) fixedArea.value = '';

  const sessionFields = h('div', { class: 'dlg-fields' }, h('label', {}, 'Area', sessionArea), h('label', {}, 'Task', task));
  const fixedFields = h('div', { class: 'dlg-fields' }, h('label', {}, 'Label', label), h('label', {}, 'Counts towards', fixedArea));
  const error = h('p', { class: 'error-detail', role: 'alert' });

  const kindButtons = /** @type {const} */ (['session', 'fixed']).map((value) => h('button', {
    type: 'button',
    'aria-pressed': String(value === kind),
    onclick: () => {
      kind = value;
      sync();
    },
  }, value === 'session' ? 'Session' : 'Fixed event'));
  function sync() {
    kindButtons.forEach((button, index) => button.setAttribute('aria-pressed', String((index === 0) === (kind === 'session'))));
    sessionFields.hidden = kind !== 'session';
    fixedFields.hidden = kind !== 'fixed';
  }
  sync();

  /** @returns {SessionEntry | FixedEntry} */
  function entry() {
    // Both selects were built from the seven fixed area ids.
    if (kind === 'session') return { kind, areaId: /** @type {AreaId} */ (sessionArea.value), taskId: task.value || null };
    return { kind, label: label.value, areaId: fixedArea.value === '' ? null : /** @type {AreaId} */ (fixedArea.value) };
  }

  /** @param {SubmitEvent} event */
  function save(event) {
    event.preventDefault();
    const edited = entry();
    try {
      // A dry run on the pure transition, so the dialog stays open on a
      // mistake but closes before the redraw on success, handing focus
      // back to the cell it came from.
      editSlot(context.state, monday, key, edited);
    } catch (failure) {
      if (!(failure instanceof SchemaError)) throw failure;
      error.textContent = kind === 'fixed' && label.value.trim() === '' ? 'Give the fixed event a label.' : failure.message;
      return;
    }
    dialog.close();
    context.apply(editSlot, monday, key, edited);
  }

  const dialog = h('dialog', { 'aria-labelledby': 'slot-title' },
    h('form', { onsubmit: save },
      h('div', { class: 'dlg-head' }, h('h2', { id: 'slot-title' }, when), h('p', {}, 'Changes this week only.')),
      h('div', { class: 'dlg-body' },
        h('div', { class: 'segmented', role: 'group', 'aria-label': 'Slot type' }, kindButtons),
        sessionFields,
        fixedFields,
        error),
      h('div', { class: 'dlg-foot' },
        h('button', { class: 'btn quiet', type: 'button', onclick: () => dialog.close() }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'submit' }, 'Save'))));

  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

/**
 * @param {string} title
 * @param {string} subtitle
 * @param {Node} actions
 */
function pageHead(title, subtitle, actions) {
  return h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, title), h('p', {}, subtitle)), actions);
}
