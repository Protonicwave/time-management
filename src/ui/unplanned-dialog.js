/**
 * @import { AppState, AreaId } from '../domain/types.js'
 * @import { Store } from './store.js'
 */
import { startSession } from '../state/transitions.js';
import { h } from './dom.js';

/**
 * Asks for an area and task, then starts a session outside the plan. The
 * dialog sits outside the view, so a redraw while it is open cannot
 * remove it.
 *
 * @param {{ state: AppState, apply: Store['apply'], clock: () => Date }} options
 */
export function openUnplannedDialog({ state, apply, clock }) {
  const area = h('select', { class: 'field' }, state.settings.areas.map((item) => h('option', { value: item.id }, item.name)));
  const task = h('select', { class: 'field' });
  const fillTasks = () => task.replaceChildren(
    h('option', { value: '' }, 'No specific task'),
    ...state.tasks
      .filter((item) => item.areaId === area.value && item.finishedOn === null)
      .map((item) => h('option', { value: item.id }, item.title)));
  area.addEventListener('change', fillTasks);
  fillTasks();

  const dialog = h('dialog', { 'aria-labelledby': 'unplanned-title' },
    h('form', { method: 'dialog' },
      h('div', { class: 'dlg-head' },
        h('h2', { id: 'unplanned-title' }, 'Unplanned session'),
        h('p', {}, 'Timed and logged like a planned one, outside the plan.')),
      h('div', { class: 'dlg-body' }, h('label', {}, 'Area', area), h('label', {}, 'Task', task)),
      h('div', { class: 'dlg-foot' },
        h('button', { class: 'btn quiet', value: 'cancel' }, 'Cancel'),
        h('button', { class: 'btn primary', value: 'start' }, 'Start'))));

  dialog.addEventListener('close', () => {
    dialog.remove();
    if (dialog.returnValue !== 'start') return;
    // The options were built from the seven fixed area ids.
    apply(startSession, { slotKey: null, areaId: /** @type {AreaId} */ (area.value), taskId: task.value || null }, clock());
  });
  document.body.append(dialog);
  dialog.showModal();
}
