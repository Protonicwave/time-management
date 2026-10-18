/** @import { AppState } from './domain/types.js' */
/** @import { Store } from './ui/store.js' */
import { NewerSchemaError, SchemaError, defaultState, parseStateJson } from './domain/schema.js';
import { createMirror } from './storage/backup-file.js';
import { STATE_KEY, loadState, saveState } from './storage/local-store.js';
import { mountRecovery } from './ui/recovery.js';
import { mountShell } from './ui/shell.js';
import { createStore } from './ui/store.js';
import { renderDeadlines } from './ui/views/deadlines.js';
import { renderReview } from './ui/views/review.js';
import { renderSettings } from './ui/views/settings.js';
import { renderTasks } from './ui/views/tasks.js';
import { renderToday } from './ui/views/today.js';
import { renderWeek } from './ui/views/week.js';

// The one place that touches the real clock, id source and storage.
const clock = () => new Date();
const newId = () => crypto.randomUUID();

const root = document.getElementById('app');
if (!root) throw new Error('index.html is missing the #app element');

const loaded = loadState(localStorage, clock());
if (loaded.kind === 'quarantined') {
  mountRecovery(root, loaded, clock, (state) => {
    // Saved straight away, or a reload would land on the recovery screen again.
    saveState(localStorage, state);
    start(root, state);
  });
} else {
  start(root, loaded.kind === 'loaded' ? loaded.state : defaultState());
}

/**
 * @param {HTMLElement} root
 * @param {AppState} initial
 */
function start(root, initial) {
  /** @type {{ render: (force: boolean) => void } | null} */
  let shell = null;
  const mirror = createMirror(() => store.state, () => shell?.render(false));
  const store = createStore(initial, (state) => {
    // Scheduled first: the mirror is the copy that matters when storage is full.
    mirror.schedule();
    saveState(localStorage, state);
  });
  shell = mountShell(root, {
    store,
    clock,
    newId,
    mirror,
    views: [
      { id: 'today', label: 'Today', render: renderToday },
      { id: 'week', label: 'Week', render: renderWeek },
      { id: 'tasks', label: 'Tasks', render: renderTasks },
      { id: 'deadlines', label: 'Deadlines', render: renderDeadlines },
      { id: 'review', label: 'Review', render: renderReview },
      { id: 'settings', label: 'Settings', render: renderSettings },
    ],
  });
  window.addEventListener('storage', (event) => adoptFromOtherTab(store, event));
  void mirror.init();
}

/**
 * Another tab saved: take its state so neither tab writes over the other
 * with something stale.
 *
 * @param {Store} store
 * @param {StorageEvent} event
 */
function adoptFromOtherTab(store, event) {
  if (event.key !== STATE_KEY || event.newValue === null) return;
  try {
    store.sync(parseStateJson(event.newValue));
  } catch (error) {
    if (!(error instanceof SchemaError || error instanceof NewerSchemaError)) throw error;
    console.error('ignored unreadable state saved by another tab:', error.message);
  }
}
