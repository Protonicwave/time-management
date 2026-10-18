/**
 * @import { AppState, AreaId, FixedEvent, SlotKey, Theme } from '../../domain/types.js'
 * @import { ViewContext } from '../shell.js'
 */
import { capacityFor } from '../../domain/allocation.js';
import { REVIEW_SLOT_KEY, SLOT_KEYS, parseSlotKey, slotKey } from '../../domain/calendar.js';
import { NewerSchemaError, SchemaError } from '../../domain/schema.js';
import { areaName } from '../../state/day.js';
import { updateSettings } from '../../state/transitions.js';
import { readBackupFile } from '../../storage/backup-file.js';
import { clock, dayMonth, h } from '../dom.js';

/** @type {readonly { value: Theme, label: string }[]} */
const THEMES = [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }];
const DAY_NAMES = /** @type {const} */ ({ mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri' });

/**
 * @param {ViewContext} context
 * @returns {Node}
 */
export function renderSettings(context) {
  return h('div', {},
    h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Settings'))),
    sessionSetting(context),
    allocationSetting(context),
    fixedEventsSetting(context),
    appearanceSetting(context),
    dataSetting(context),
    backupFileSetting(context));
}

/**
 * Saves a field once its change event is over. Applying inside the event
 * would redraw while focus is still leaving the field, so Tab would land
 * on an element that has just been replaced.
 *
 * @param {ViewContext} context
 * @param {(state: AppState) => AppState} change
 * @param {HTMLElement} error where a rejected value is explained
 */
function commitLater(context, change, error) {
  setTimeout(() => {
    try {
      context.apply(change);
    } catch (failure) {
      if (!(failure instanceof SchemaError)) throw failure;
      error.textContent = `Not saved. ${failure.message}`;
    }
  });
}

/**
 * An empty field is not zero, so it is rejected rather than saved as one.
 * @param {HTMLInputElement} input
 * @returns {number}
 */
function numberIn(input) {
  return input.value.trim() === '' ? Number.NaN : Number(input.value);
}

/** @param {ViewContext} context */
function sessionSetting(context) {
  const { settings } = context.state;
  const error = h('p', { class: 'error-detail', role: 'alert' });
  /**
   * @param {'focusMinutes' | 'breakMinutes'} key
   * @param {string} label
   */
  const field = (key, label) => {
    const id = `setting-${key}`;
    const input = h('input', {
      id,
      class: 'field num',
      type: 'number',
      min: key === 'focusMinutes' ? 1 : 0,
      max: key === 'focusMinutes' ? 120 : 60,
      step: 1,
      value: settings[key],
      'data-focus-key': id,
      onchange: () => commitLater(context, (state) => updateSettings(state, { [key]: numberIn(input) }), error),
    });
    return h('div', { class: 'pair' }, h('label', { for: id }, label), input, h('span', { class: 'muted' }, 'minutes'));
  };

  return h('div', { class: 'setting' },
    h('div', {},
      h('h2', {}, 'Session length'),
      h('p', { class: 'desc' }, 'One session is focus plus break, starting on the hour. A session already running keeps the lengths it started with.')),
    h('div', { class: 'controls' }, field('focusMinutes', 'Focus'), field('breakMinutes', 'Break'), error));
}

/** @param {ViewContext} context */
function allocationSetting(context) {
  const { settings } = context.state;
  const error = h('p', { class: 'error-detail', role: 'alert' });
  const capacity = capacityFor(settings.recurring);
  const allocated = settings.areas.reduce((sum, area) => sum + area.target, 0);

  /**
   * @param {AreaId} areaId
   * @param {{ name?: string, target?: number }} change
   */
  const saveArea = (areaId, change) => commitLater(context, (state) => updateSettings(state, {
    areas: state.settings.areas.map((area) => (area.id === areaId ? { ...area, ...change } : area)),
  }), error);

  const rows = settings.areas.map((area) => {
    const name = h('input', {
      class: 'field',
      maxlength: 80,
      value: area.name,
      'aria-label': `Name of ${area.name}`,
      'data-focus-key': `area-name-${area.id}`,
      // The buffer is what is left over, whatever it is called.
      disabled: area.id === 'buffer',
      onchange: () => saveArea(area.id, { name: name.value }),
    });
    const target = h('input', {
      class: 'field num',
      type: 'number',
      min: 0,
      max: SLOT_KEYS.length,
      step: 1,
      value: area.target,
      'aria-label': `Sessions a week for ${area.name}`,
      'data-focus-key': `area-target-${area.id}`,
      onchange: () => saveArea(area.id, { target: numberIn(target) }),
    });
    return h('div', { class: 'area-row', 'data-area': area.id }, h('span', { class: 'swatch' }), name, target);
  });

  const over = allocated > capacity;
  const balance = over
    ? `${allocated - capacity} more than a week holds: the buffer is cut first, then the rest scaled down.`
    : allocated < capacity ? `${capacity - allocated} spare ${capacity - allocated === 1 ? 'goes' : 'go'} to the buffer.` : '';

  return h('div', { class: 'setting' },
    h('div', {},
      h('h2', {}, 'Weekly allocation'),
      h('p', { class: 'desc' }, 'Sessions per area. Projects come first when a week is short. The buffer is cut before anything else. Applies to weeks not yet planned; regenerate a week to apply it there.')),
    h('div', { class: 'controls' },
      rows,
      h('div', { class: 'area-total' },
        h('span', {}, 'Allocated'),
        h('span', { class: over ? 'over' : null }, h('span', { class: 'mono' }, String(allocated)), ' of ', h('span', { class: 'mono' }, String(capacity)), ' sessions')),
      balance && h('p', { class: over ? 'desc over' : 'desc' }, balance),
      error));
}

/** @param {ViewContext} context */
function fixedEventsSetting(context) {
  const { state } = context;
  const order = (/** @type {FixedEvent} */ event) => SLOT_KEYS.indexOf(slotKey(event.dayId, event.slotId));
  const events = [...state.settings.recurring].sort((a, b) => order(a) - order(b));
  const free = freeSlots(state.settings.recurring);
  const review = parseSlotKey(REVIEW_SLOT_KEY);

  return h('div', { class: 'setting' },
    h('div', {},
      h('h2', {}, 'Weekly fixed events'),
      h('p', { class: 'desc' }, 'Placed before the plan is generated. Link one to an area and it counts towards that area. Applies to weeks not yet planned; change this week in Week.')),
    h('div', { class: 'controls' },
      events.map((event) => h('div', { class: 'event-row' },
        h('span', { class: 'mono' }, `${DAY_NAMES[event.dayId]} ${clock(Number(event.slotId))}`),
        h('span', {}, event.label),
        event.areaId
          ? h('span', { class: 'area', 'data-area': event.areaId }, h('span', { class: 'swatch' }), areaName(state, event.areaId))
          : h('span', { class: 'area faint' }, 'Not counted'),
        h('button', {
          class: 'btn small quiet',
          type: 'button',
          'aria-label': `Remove ${event.label}`,
          'data-focus-key': `remove-${event.dayId}-${event.slotId}`,
          onclick: () => context.apply((current) => updateSettings(current, {
            recurring: current.settings.recurring.filter((item) => item.dayId !== event.dayId || item.slotId !== event.slotId),
          })),
        }, 'Remove'))),
      h('div', { class: 'event-row' },
        h('span', { class: 'mono' }, `${DAY_NAMES[review.dayId]} ${clock(Number(review.slotId))}`),
        h('span', {}, 'Weekly review'),
        h('span', { class: 'area faint' }, 'Always'),
        h('span')),
      h('div', {}, free.length === 0
        ? h('p', { class: 'desc' }, 'Every slot already has a fixed event.')
        : h('button', { class: 'btn small', type: 'button', 'data-focus-key': 'add-fixed', onclick: () => openFixedEventDialog(context, free) }, 'Add fixed event'))));
}

/**
 * @param {readonly FixedEvent[]} recurring
 * @returns {SlotKey[]}
 */
function freeSlots(recurring) {
  const taken = new Set(recurring.map((event) => slotKey(event.dayId, event.slotId)));
  return SLOT_KEYS.filter((key) => key !== REVIEW_SLOT_KEY && !taken.has(key));
}

/**
 * Only free slots are offered, so the event cannot clash with another.
 * The dialog sits outside the view, so a redraw cannot remove it.
 *
 * @param {ViewContext} context
 * @param {readonly SlotKey[]} free
 */
function openFixedEventDialog(context, free) {
  const { state } = context;
  const when = h('select', { class: 'field' }, free.map((key) => {
    const { dayId, slotId } = parseSlotKey(key);
    return h('option', { value: key }, `${DAY_NAMES[dayId]} ${clock(Number(slotId))}`);
  }));
  const label = h('input', { class: 'field', maxlength: 80, placeholder: 'Group meeting', required: true });
  const area = h('select', { class: 'field' },
    h('option', { value: '' }, 'Not counted towards an area'),
    state.settings.areas.map((item) => h('option', { value: item.id }, item.name)));
  const error = h('p', { class: 'error-detail', role: 'alert' });

  /** @returns {FixedEvent} */
  function event() {
    // The selects were built from slot keys and the fixed area ids.
    const { dayId, slotId } = parseSlotKey(/** @type {SlotKey} */ (when.value));
    return { dayId, slotId, label: label.value, areaId: area.value === '' ? null : /** @type {AreaId} */ (area.value) };
  }

  /** @param {SubmitEvent} submit */
  function save(submit) {
    submit.preventDefault();
    const added = event();
    /** @param {AppState} current */
    const change = (current) => updateSettings(current, { recurring: [...current.settings.recurring, added] });
    try {
      // A dry run, so a mistake keeps the dialog open and success closes
      // it before the redraw, returning focus to the button.
      change(context.state);
    } catch (failure) {
      if (!(failure instanceof SchemaError)) throw failure;
      error.textContent = failure.message;
      return;
    }
    dialog.close();
    context.apply(change);
  }

  const dialog = h('dialog', { 'aria-labelledby': 'fixed-title' },
    h('form', { onsubmit: save },
      h('div', { class: 'dlg-head' },
        h('h2', { id: 'fixed-title' }, 'Add a weekly fixed event'),
        h('p', {}, 'Placed in every week planned from now on.')),
      h('div', { class: 'dlg-body' },
        h('label', {}, 'When', when),
        h('label', {}, 'Label', label),
        h('label', {}, 'Counts towards', area),
        error),
      h('div', { class: 'dlg-foot' },
        h('button', { class: 'btn quiet', type: 'button', onclick: () => dialog.close() }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'submit' }, 'Add'))));

  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

/** @param {ViewContext} context */
function appearanceSetting(context) {
  const { theme } = context.state.settings;
  return h('div', { class: 'setting' },
    h('div', {},
      h('h2', {}, 'Appearance'),
      h('p', { class: 'desc' }, 'System follows your computer\'s light or dark setting.')),
    h('div', { class: 'controls' },
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Theme' }, THEMES.map((option) => h('button', {
        type: 'button',
        'aria-pressed': String(option.value === theme),
        'data-focus-key': `theme-${option.value}`,
        onclick: () => context.apply(updateSettings, { theme: option.value }),
      }, option.label)))));
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
        h('button', { class: 'btn', type: 'button', 'data-focus-key': 'import', onclick: () => fileInput.click() }, 'Import backup'),
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
