/**
 * @import { AreaId } from '../../domain/types.js'
 * @import { DatedDeadline } from '../../state/deadlines.js'
 * @import { ViewContext } from '../shell.js'
 */
import { localDateOf } from '../../domain/calendar.js';
import { SchemaError } from '../../domain/schema.js';
import { areaName } from '../../state/day.js';
import { groupDeadlines, isSoon } from '../../state/deadlines.js';
import { addDeadline, deleteDeadline } from '../../state/transitions.js';
import { daysAway, h, shortDate } from '../dom.js';

/**
 * @param {ViewContext} context
 * @returns {Node}
 */
export function renderDeadlines(context) {
  const { state } = context;
  const groups = groupDeadlines(state.deadlines, localDateOf(context.now));

  return h('div', {},
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Deadlines'), h('p', {}, `Plan backwards from these.${context.hasView('today') ? ' The nearest show on Today.' : ''}`))),
    addForm(context),
    state.deadlines.length === 0 && h('p', { class: 'empty' }, 'Add what is due above, with its date and the area it belongs to.'),
    group(context, 'Next 14 days', groups.next),
    group(context, 'Later', groups.later),
    group(context, 'Past', groups.past));
}

/** @param {ViewContext} context */
function addForm(context) {
  const { state } = context;
  const title = h('input', { class: 'field', required: true, maxlength: 2000, placeholder: 'What is due', 'aria-label': 'Deadline title', 'data-focus-key': 'deadline-title' });
  const date = h('input', { class: 'field', type: 'date', required: true, 'aria-label': 'Due date' });
  // The buffer is overflow time, not something work is due for.
  const area = h('select', { class: 'field', 'aria-label': 'Area' },
    state.settings.areas.filter((item) => item.id !== 'buffer').map((item) => h('option', { value: item.id }, item.name)));
  const error = h('p', { class: 'error-detail', role: 'alert' });

  /** @param {SubmitEvent} event */
  function add(event) {
    event.preventDefault();
    try {
      // The options were built from the fixed area ids.
      context.apply(addDeadline, { id: context.newId(), title: title.value, date: date.value, areaId: /** @type {AreaId} */ (area.value) });
    } catch (failure) {
      if (!(failure instanceof SchemaError)) throw failure;
      error.textContent = failure.message;
    }
  }

  return h('form', { class: 'deadline-form', onsubmit: add },
    title, date, area,
    h('button', { class: 'btn primary', type: 'submit' }, 'Add'),
    error);
}

/**
 * @param {ViewContext} context
 * @param {string} heading
 * @param {DatedDeadline[]} items
 */
function group(context, heading, items) {
  if (items.length === 0) return null;
  const { state } = context;
  return h('section', { class: 'dl-group', 'aria-label': heading },
    h('h2', {}, heading),
    h('ul', { class: 'dl' }, items.map(({ deadline, days }) => {
      const past = days < 0;
      const remove = () => {
        if (confirm(`Delete the deadline "${deadline.title}"?`)) context.apply(deleteDeadline, deadline.id);
      };
      return h('li', { class: past ? 'past' : null },
        h('span', { class: 'date' }, shortDate(deadline.date)),
        h('span', { class: 'title' }, deadline.title),
        h('span', { class: 'area', 'data-area': deadline.areaId }, h('span', { class: 'swatch' }), areaName(state, deadline.areaId)),
        h('span', { class: past ? 'left past' : isSoon(days) ? 'left soon' : 'left' }, daysAway(days)),
        h('button', { class: 'btn small quiet reveal', type: 'button', 'aria-label': `Delete ${deadline.title}`, onclick: remove }, 'Delete'));
    })));
}
