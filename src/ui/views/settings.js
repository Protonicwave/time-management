/** @import { ViewContext } from '../shell.js' */
import { NewerSchemaError, SchemaError } from '../../domain/schema.js';
import { readBackupFile } from '../../storage/backup-file.js';
import { dayMonth, h } from '../dom.js';

/**
 * @param {ViewContext} context
 * @returns {Node}
 */
export function renderSettings(context) {
  return h('div', {},
    h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Settings'))),
    dataSetting(context),
    backupFileSetting(context));
}

/** @param {ViewContext} context */
function dataSetting(context) {
  const error = h('p', { class: 'error-detail', role: 'alert' });
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
    error.textContent = '';
    try {
      const imported = await readBackupFile(file);
      if (confirm(`Replace everything in Logbook with the backup in ${file.name}?`)) context.apply(() => imported);
    } catch (failure) {
      if (!(failure instanceof SchemaError || failure instanceof NewerSchemaError)) throw failure;
      error.textContent = `${file.name} was not imported. ${failure.message}`;
    }
  }

  const { lastExportOn } = context.state;
  return h('div', { class: 'setting' },
    h('div', {},
      h('h2', {}, 'Data'),
      h('p', { class: 'desc' }, 'Everything stays in this browser. Export weekly; importing replaces what is here.')),
    h('div', { class: 'controls' },
      h('div', { class: 'button-row' },
        h('button', { class: 'btn', type: 'button', 'data-focus-key': 'export', onclick: context.exportBackup }, 'Export backup'),
        h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, 'Import backup'),
        fileInput),
      h('p', { class: 'desc' }, lastExportOn ? `Last exported ${dayMonth(lastExportOn)}.` : 'Not exported yet.'),
      error));
}

/** @param {ViewContext} context */
function backupFileSetting(context) {
  const { mirror } = context;
  const name = mirror.fileName();
  /** @param {string} label */
  const choose = (label) => h('button', { class: 'btn', type: 'button', 'data-focus-key': 'mirror', onclick: () => void mirror.choose() }, label);

  /** @type {Node[]} */
  let controls;
  switch (mirror.status()) {
    case 'unsupported':
      controls = [h('p', { class: 'desc' }, 'This browser cannot write to a file on your computer. Use Export backup instead.')];
      break;
    case 'off':
      controls = [h('div', { class: 'button-row' }, choose('Choose backup file'))];
      break;
    case 'on':
      controls = [h('div', { class: 'button-row' }, h('span', {}, 'Writing to ', h('span', { class: 'mono' }, name ?? '')), choose('Change file'))];
      break;
    case 'reconnect':
      controls = [
        h('p', { class: 'desc' }, `Chrome needs your permission again to write to ${name ?? 'the backup file'}.`),
        h('div', { class: 'button-row' },
          h('button', { class: 'btn', type: 'button', 'data-focus-key': 'mirror', onclick: () => void mirror.reconnect() }, 'Reconnect backup file')),
      ];
      break;
    case 'failed':
      controls = [
        h('p', { class: 'desc' }, `The last write failed: ${mirror.failure() ?? 'unknown error'}`),
        h('div', { class: 'button-row' }, choose('Choose file again')),
      ];
      break;
  }

  return h('div', { class: 'setting' },
    h('div', {},
      h('h2', {}, 'Backup file'),
      h('p', { class: 'desc' }, 'Logbook rewrites a file you choose a moment after every change, so clearing the browser loses nothing.')),
    h('div', { class: 'controls' }, controls));
}
