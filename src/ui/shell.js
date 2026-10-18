/**
 * @import { AppState, Theme } from '../domain/types.js'
 * @import { DockModel } from '../state/day.js'
 * @import { Mirror } from '../storage/backup-file.js'
 * @import { Store } from './store.js'
 */
import { localDateOf } from '../domain/calendar.js';
import { readTimer } from '../domain/timer.js';
import { describeDock, entryTitle, isFirstRun, weekShownOn } from '../state/day.js';
import { advanceTimer, ensureWeek, markExported, startSession, stopSession } from '../state/transitions.js';
import { backupFileName, downloadText, serialise } from '../storage/backup-file.js';
import { clock, countdown, h, shortDayMonth, weekday } from './dom.js';
import { openUnplannedDialog } from './unplanned-dialog.js';

/** @typedef {'today' | 'week' | 'tasks' | 'deadlines' | 'review' | 'settings'} ViewId */

/** Keys 1 to 6 follow this order whichever views are present. @type {readonly ViewId[]} */
const VIEW_ORDER = ['today', 'week', 'tasks', 'deadlines', 'review', 'settings'];

/**
 * @typedef {object} ViewContext
 * @property {AppState} state
 * @property {Date} now when this render happened; actions read clock() instead
 * @property {() => Date} clock
 * @property {Store['apply']} apply
 * @property {() => string} newId
 * @property {(id: ViewId) => void} navigate
 * @property {(id: ViewId) => boolean} hasView
 * @property {() => void} refresh redraws the view after a change held only in the view
 * @property {() => void} exportBackup
 * @property {Mirror} mirror
 */

/** @typedef {{ id: ViewId, label: string, render: (context: ViewContext) => Node }} View */

/** @typedef {{ label: string, run: () => void, space: boolean }} DockAction */

/**
 * Lays out the sidebar, notices and the current view, and runs the one
 * timer tick. The tick only redraws the countdown unless the state or the
 * minute changes, and a view with unsaved input is not redrawn by the tick.
 *
 * @param {HTMLElement} root
 * @param {{ store: Store, views: readonly View[], clock: () => Date, newId: () => string, mirror: Mirror }} options
 * @returns {{ render: (force: boolean) => void }}
 */
export function mountShell(root, { store, views, clock: now, newId, mirror }) {
  const app = h('div', { class: 'app' });
  root.replaceChildren(app);
  let renderedMinute = '';
  let mainStale = false;
  let userAction = false;
  /** Focus to move to once a view has been drawn, for a shortcut that opens one. @type {{ viewId: ViewId, selector: string } | null} */
  let pendingFocus = null;

  /** @type {Store['apply']} */
  const apply = (transition, ...args) => {
    // A change the user made redraws the view even over unsaved input,
    // which the action has just consumed.
    userAction = true;
    try {
      store.apply(transition, ...args);
    } finally {
      userAction = false;
    }
  };

  /** @param {ViewId} id */
  const hasView = (id) => views.some((view) => view.id === id);

  /** @param {ViewId} id */
  function navigate(id) {
    if (location.hash === `#${id}`) render(true);
    else location.hash = id;
  }

  function exportBackup() {
    const today = localDateOf(now());
    downloadText(serialise(store.state), backupFileName(today));
    apply(markExported, today);
  }

  function currentView() {
    return views.find((view) => `#${view.id}` === location.hash) ?? /** @type {View} */ (views[0]);
  }

  /** @param {boolean} force */
  function render(force) {
    const time = now();
    const focusKey = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focusKey : undefined;
    applyTheme(store.state.settings.theme);

    const oldMain = app.querySelector('main');
    const redrawMain = force || !oldMain || !hasUnsavedInput(oldMain);
    const main = redrawMain ? renderMain(time) : oldMain;
    app.replaceChildren(renderSidebar(time), main);
    mainStale = !redrawMain;
    renderedMinute = minuteOf(time);
    updateLive(time);

    if (focusKey) /** @type {HTMLElement | null} */ (app.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`))?.focus();
    if (pendingFocus && pendingFocus.viewId === currentView().id) {
      /** @type {HTMLElement | null} */ (app.querySelector(pendingFocus.selector))?.focus();
      pendingFocus = null;
    }
  }

  /** @param {Date} time */
  function renderMain(time) {
    const view = currentView();
    /** @type {ViewContext} */
    const context = { state: store.state, now: time, clock: now, apply, newId, navigate, hasView, refresh: () => render(true), exportBackup, mirror };
    return h('main', { class: 'main' },
      notices(),
      h('section', { class: 'view', 'aria-label': view.label }, view.render(context)));
  }

  /** @param {Date} time */
  function renderSidebar(time) {
    const view = currentView();
    return h('aside', { class: 'sidebar' },
      h('div', { class: 'brand' }, h('b', {}, 'Logbook'), h('span', {}, `Week of ${shortDayMonth(weekShownOn(localDateOf(time)))}`)),
      h('nav', { class: 'nav', 'aria-label': 'Views' }, views.map((item) => h('a', {
        href: `#${item.id}`,
        'aria-current': item === view ? 'page' : null,
        'data-focus-key': `nav-${item.id}`,
      }, item.label, h('kbd', {}, String(VIEW_ORDER.indexOf(item.id) + 1))))),
      renderDock(time));
  }

  /** @param {Date} time */
  function renderDock(time) {
    const model = describeDock(store.state, time);
    const action = dockAction(model);
    const reading = readTimer(store.state.timer, time);
    const text = dockText(model);
    return h('section', { class: model.kind === 'focus' ? 'dock' : 'dock idle', 'aria-label': 'Timer' },
      h('div', { class: 'dock-bar' }, h('span', { 'data-live-progress': true, style: '--progress: 0%' })),
      h('div', { class: 'dock-label' }, h('i'), h('span', {}, text.label)),
      h('div', { class: 'dock-time', 'data-live-countdown': reading !== null }, text.time),
      h('div', { class: 'dock-task' }, text.task),
      action && h('div', { class: 'dock-actions' },
        h('button', { class: 'btn small', type: 'button', 'data-focus-key': 'dock-action', onclick: action.run }, action.label),
        action.space && h('kbd', { title: 'Start or stop' }, 'Space')));
  }

  /**
   * @param {DockModel} model
   * @returns {{ label: string, time: string, task: string }} time is replaced by the live countdown while a timer runs
   */
  function dockText(model) {
    const state = store.state;
    switch (model.kind) {
      case 'setup':
        return { label: 'No plan yet', time: '--:--', task: 'Generate your first week to start' };
      case 'focus':
        return { label: `Focus, session ${model.number}`, time: '', task: model.taskTitle ? `${model.taskTitle}, ${model.areaName}` : model.areaName };
      case 'break':
        return {
          label: 'Break',
          time: '',
          task: model.next ? `Next at ${clock(model.next.hour)}: ${entryTitle(state, model.next.entry)}` : 'That was the last session today',
        };
      case 'next-today':
        return { label: 'Next session', time: clock(model.row.hour), task: entryTitle(state, model.row.entry) };
      case 'next-day':
        return model.row
          ? { label: 'Next session', time: clock(model.row.hour), task: `${weekday(model.date)}: ${entryTitle(state, model.row.entry)}` }
          : { label: 'Next session', time: '--:--', task: `${weekday(model.date)}: nothing planned` };
    }
  }

  /**
   * @param {DockModel} model
   * @returns {DockAction | null}
   */
  function dockAction(model) {
    switch (model.kind) {
      case 'setup':
        return { label: 'Set up', run: () => navigate('today'), space: false };
      case 'focus':
        return { label: 'Stop early', run: () => apply(stopSession, now(), newId()), space: true };
      case 'break':
        return { label: 'Skip break', run: () => apply(stopSession, now(), newId()), space: true };
      case 'next-today':
        return { label: model.early ? 'Start early' : 'Start', run: () => apply(startSession, model.session, now()), space: true };
      case 'next-day':
        return { label: 'Unplanned', run: () => openUnplannedDialog({ state: store.state, apply, clock: now }), space: false };
    }
  }

  function notices() {
    const status = mirror.status();
    return [
      store.saveError && notice('Your latest change is not saved because browser storage is full. Export a backup so nothing is lost.', 'Export backup', exportBackup),
      status === 'reconnect' && notice('The backup file needs your permission again after a restart.', 'Reconnect backup file', () => void mirror.reconnect()),
      status === 'failed' && notice(`The backup file could not be written: ${mirror.failure()}`, 'Choose file again', () => void mirror.choose()),
    ];
  }

  /** @param {Date} time */
  function updateLive(time) {
    const reading = readTimer(store.state.timer, time);
    for (const element of app.querySelectorAll('[data-live-countdown]')) {
      if (reading) element.textContent = countdown(reading.remainingSeconds);
    }
    for (const element of app.querySelectorAll('[data-live-progress]')) {
      /** @type {HTMLElement} */ (element).style.setProperty('--progress', `${((reading?.progress ?? 0) * 100).toFixed(2)}%`);
    }
    document.title = reading ? `${countdown(reading.remainingSeconds)} Logbook` : 'Logbook';
  }

  function tick() {
    const time = now();
    store.apply(advanceTimer, time, newId());
    if (!isFirstRun(store.state)) store.apply(ensureWeek, weekShownOn(localDateOf(time)));
    if (mainStale || minuteOf(time) !== renderedMinute) render(false);
    else updateLive(time);
  }

  /** @param {KeyboardEvent} event */
  function onKey(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, select, textarea, [contenteditable]') || document.querySelector('dialog[open]')) return;

    const viewId = VIEW_ORDER[Number(event.key) - 1];
    if (/^[1-6]$/.test(event.key) && viewId && hasView(viewId)) {
      navigate(viewId);
    } else if (event.key.toLowerCase() === 'n' && hasView('tasks')) {
      event.preventDefault();
      pendingFocus = { viewId: 'tasks', selector: '[data-add-task]' };
      navigate('tasks');
    } else if (event.key === ' ' && !target?.closest('button, a, summary')) {
      const action = dockAction(describeDock(store.state, now()));
      if (!action?.space) return;
      event.preventDefault();
      action.run();
    }
  }

  store.subscribe(() => render(userAction));
  window.addEventListener('hashchange', () => {
    render(true);
    window.scrollTo(0, 0);
  });
  document.addEventListener('keydown', onKey);
  // The first tick logs any session that ended while the page was closed,
  // then draws everything because nothing has been drawn yet.
  tick();
  setInterval(tick, 1000);
  return { render };
}

/**
 * @param {string} text
 * @param {string} label
 * @param {() => void} run
 */
function notice(text, label, run) {
  return h('div', { class: 'notice', role: 'status' }, h('span', {}, text), h('button', { class: 'btn small', type: 'button', onclick: run }, label));
}

/** @param {Theme} theme */
function applyTheme(theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

/** @param {Date} time */
function minuteOf(time) {
  return `${localDateOf(time)} ${clock(time.getHours(), time.getMinutes())}`;
}

/**
 * Typing in progress, or typed and not yet acted on.
 * @param {Element} container
 * @returns {boolean}
 */
function hasUnsavedInput(container) {
  if (document.activeElement && container.contains(document.activeElement) && document.activeElement.matches('input, select, textarea')) return true;
  for (const field of container.querySelectorAll('input, textarea')) {
    const input = /** @type {HTMLInputElement} */ (field);
    if (input.type === 'checkbox' || input.type === 'radio' ? input.checked !== input.defaultChecked : input.value !== input.defaultValue) return true;
  }
  for (const select of container.querySelectorAll('select')) {
    // With no option marked selected the browser selects the first.
    const initial = [...select.options].findIndex((option) => option.defaultSelected);
    if (select.selectedIndex !== Math.max(0, initial)) return true;
  }
  return false;
}
