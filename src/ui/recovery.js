/**
 * @import { AppState } from '../domain/types.js'
 * @import { LoadResult } from '../storage/local-store.js'
 */
import { localDateOf } from '../domain/calendar.js';
import { NewerSchemaError, SchemaError, defaultState } from '../domain/schema.js';
import { downloadText, readBackupFile } from '../storage/backup-file.js';
import { h } from './dom.js';

/**
 * Shown instead of the app when saved data could not be read. Every way
 * out keeps the unreadable text reachable: it is quarantined, offered as
 * a download, and starting fresh over it asks first.
 *
 * @param {HTMLElement} root
 * @param {Extract<LoadResult, { kind: 'quarantined' }>} failure
 * @param {() => Date} clock
 * @param {(state: AppState) => void} onRecovered
 */
export function mountRecovery(root, failure, clock, onRecovered) {
  const { raw, error, quarantineKey } = failure;
  const importError = h('p', { class: 'error-detail', role: 'alert' });
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'visually-hidden',
    tabindex: -1,
    'aria-hidden': 'true',
    onchange: () => void importChosen(),
  });

  async function importChosen() {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.value = '';
    importError.textContent = '';
    try {
      onRecovered(await readBackupFile(file));
    } catch (failure) {
      if (!(failure instanceof SchemaError || failure instanceof NewerSchemaError)) throw failure;
      importError.textContent = `${file.name} was not imported. ${failure.message}`;
    }
  }

  function startFresh() {
    const question = quarantineKey
      ? 'Start with an empty Logbook? The unreadable copy stays in this browser.'
      : 'Start with an empty Logbook? The unreadable data will be overwritten, so download it first if you may need it.';
    if (confirm(question)) onRecovered(defaultState());
  }

  root.replaceChildren(h('div', { class: 'recovery' },
    h('header', { class: 'page-head' },
      h('div', {},
        h('h1', {}, 'Your saved data could not be read'),
        h('p', {}, 'Nothing has been overwritten. Choose how to carry on.'))),
    h('div', { class: 'state-panel' },
      h('h2', {}, error instanceof NewerSchemaError ? 'Saved by a newer version' : 'Damaged or changed outside Logbook'),
      h('p', {}, error instanceof NewerSchemaError
        ? 'Open it with the version of Logbook that saved it, or import an older backup here.'
        : 'Import your latest backup to carry on from it. The problem found was:'),
      h('p', { class: 'error-detail' }, error.message),
      h('p', {}, quarantineKey
        ? `The unreadable copy is kept in this browser under ${quarantineKey}.`
        : 'There was no room to keep a separate copy, so download it before starting fresh.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => fileInput.click() }, 'Import backup'),
        h('button', { class: 'btn', type: 'button', onclick: () => downloadText(raw, `logbook-unreadable-${localDateOf(clock())}.json`) }, 'Download unreadable data'),
        h('button', { class: 'btn quiet', type: 'button', onclick: startFresh }, 'Start fresh'),
        fileInput),
      importError)));
}
