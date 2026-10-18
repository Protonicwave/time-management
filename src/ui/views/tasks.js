/**
 * @import { AreaId, LocalDate } from '../../domain/types.js'
 * @import { LikelyLeft, TaskGroup, TaskRow } from '../../state/tasks.js'
 * @import { ViewContext } from '../shell.js'
 */
import { localDateOf } from '../../domain/calendar.js';
import { SchemaError } from '../../domain/schema.js';
import { areaName } from '../../state/day.js';
import { estimateLearning, taskGroups } from '../../state/tasks.js';
import { addTask, deleteTask, setTaskFinished } from '../../state/transitions.js';
import { h, plural, tenths } from '../dom.js';

const MODULE_AREAS = /** @type {readonly AreaId[]} */ (['module-1', 'module-2', 'module-3']);

// Areas whose earlier finished tasks are unfolded: page-load memory.
/** @type {Set<AreaId>} */
const unfolded = new Set();

/**
 * @param {ViewContext} context
 * @returns {Node}
 */
export function renderTasks(context) {
  const { state } = context;
  const today = localDateOf(context.now);
  const groups = taskGroups(state, today);

  return h('div', {},
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Tasks'), h('p', {}, `Estimates are in sessions of ${state.settings.focusMinutes} minutes.`)),
      h('div', { class: 'head-actions' }, h('span', { class: 'faint' }, 'Add task'), h('kbd', {}, 'N'))),
    learningLine(context),
    groups.map((group, index) => taskGroup(context, group, today, index === 0)));
}

/** @param {ViewContext} context */
function learningLine(context) {
  const { factor, basis } = estimateLearning(context.state);
  if (factor === null) {
    return h('p', { class: 'note-line' },
      'Give each task an estimate in sessions. Once you finish tasks with logged work, the Likely left column adjusts to how long your work really takes.');
  }
  return h('p', { class: 'note-line' },
    `Across ${basis === 1 ? 'the one finished task' : `the ${basis} finished tasks`} with logged work, the work took `,
    h('b', { class: 'mono' }, `${tenths(factor)}×`),
    ' your estimate. The Likely left column is adjusted by that.');
}

/**
 * @param {ViewContext} context
 * @param {TaskGroup} group
 * @param {LocalDate} today
 * @param {boolean} first takes the N shortcut
 */
function taskGroup(context, group, today, first) {
  const name = areaName(context.state, group.areaId);
  const shownEarlier = unfolded.has(group.areaId) ? group.earlier : [];
  const rows = [...group.open, ...group.recent, ...shownEarlier];
  const toggle = () => {
    if (unfolded.has(group.areaId)) unfolded.delete(group.areaId);
    else unfolded.add(group.areaId);
    context.refresh();
  };

  return h('section', { class: 'group', 'data-area': group.areaId, 'aria-label': name },
    h('div', { class: 'group-head' },
      h('span', { class: 'swatch' }),
      h('h2', {}, name),
      h('span', { class: 'muted' }, group.open.length === 0 ? 'No open tasks' : `${group.open.length} open`)),
    rows.length > 0 && h('ul', { class: 'tasks' },
      h('li', { class: 'task head', 'aria-hidden': 'true' },
        h('span'), h('span', {}, 'Task'), h('span', { class: 'num' }, 'Estimate'), h('span', { class: 'num' }, 'Logged'), h('span', { class: 'num' }, 'Likely left')),
      rows.map((row) => taskItem(context, row, today))),
    addRow(context, group, name, first, rows.length === 0),
    group.earlier.length > 0 && h('button', { class: 'show-more', type: 'button', 'data-focus-key': `fold-${group.areaId}`, onclick: toggle },
      unfolded.has(group.areaId) ? 'Hide earlier finished tasks' : `Show ${group.earlier.length} finished`));
}

/**
 * @param {ViewContext} context
 * @param {TaskRow} row
 * @param {LocalDate} today
 */
function taskItem(context, row, today) {
  const { task, logged, left } = row;
  const finished = task.finishedOn !== null;

  function remove() {
    const sessions = context.state.logs.filter((log) => log.taskId === task.id).length;
    const kept = sessions === 0 ? '' : ` Its ${plural(sessions, 'logged session')} still count towards ${areaName(context.state, task.areaId)}.`;
    if (confirm(`Delete "${task.title}"?${kept}`)) context.apply(deleteTask, task.id);
  }

  return h('li', { class: finished ? 'task finished' : 'task' },
    h('input', {
      type: 'checkbox',
      checked: finished,
      'aria-label': `Finished: ${task.title}`,
      'data-focus-key': `finish-${task.id}`,
      onchange: () => context.apply(setTaskFinished, task.id, finished ? null : today),
    }),
    h('span', { class: 'title' },
      h('span', {}, task.title),
      h('button', { class: 'btn small quiet reveal', type: 'button', 'aria-label': `Delete ${task.title}`, 'data-focus-key': `delete-${task.id}`, onclick: remove }, 'Delete')),
    h('span', { class: 'num', 'aria-label': `Estimate ${task.estimate}` }, String(task.estimate)),
    h('span', { class: 'num', 'aria-label': `Logged ${tenths(logged)}` }, tenths(logged)),
    likelyCell(left));
}

/** @param {LikelyLeft} left */
function likelyCell(left) {
  switch (left.kind) {
    case 'done':
      return h('span', { class: 'num' }, 'done');
    case 'over':
      return h('span', { class: 'num over', 'aria-label': 'Over the adjusted estimate' }, 'over');
    case 'left':
      return h('span', { class: 'num', 'aria-label': `Likely left ${tenths(left.sessions)}` }, tenths(left.sessions));
  }
}

/**
 * @param {ViewContext} context
 * @param {TaskGroup} group
 * @param {string} name
 * @param {boolean} first
 * @param {boolean} empty
 */
function addRow(context, group, name, first, empty) {
  const isModule = MODULE_AREAS.includes(group.areaId);
  const title = h('input', {
    class: 'field',
    maxlength: 2000,
    placeholder: empty
      ? (isModule ? 'Nothing planned here. Add the next lecture to catch up on.' : `Nothing open here. Add the next task for ${name}.`)
      : `Add a task to ${name}`,
    'aria-label': `New task for ${name}`,
    'data-focus-key': `add-${group.areaId}`,
    'data-add-task': first,
  });
  const estimate = h('input', {
    class: 'field num',
    type: 'number',
    min: 1,
    max: 100,
    step: 1,
    value: isModule ? 1 : 2,
    'aria-label': 'Estimate in sessions',
  });
  const error = h('p', { class: 'error-detail', role: 'alert' });

  /** @param {SubmitEvent} event */
  function add(event) {
    event.preventDefault();
    if (title.value.trim() === '') return;
    try {
      context.apply(addTask, { id: context.newId(), areaId: group.areaId, title: title.value, estimate: Number(estimate.value) });
    } catch (failure) {
      if (!(failure instanceof SchemaError)) throw failure;
      error.textContent = failure.path.endsWith('estimate') ? 'The estimate is a whole number of sessions from 1 to 100.' : failure.message;
    }
  }

  return h('form', { class: empty ? 'add-row first' : 'add-row', onsubmit: add },
    h('span', { class: 'plus', 'aria-hidden': 'true' }, '+'),
    title,
    estimate,
    h('button', { class: 'btn small', type: 'submit', 'data-focus-key': `add-submit-${group.areaId}` }, 'Add'),
    error);
}
