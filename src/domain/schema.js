/**
 * @import { AppState, Area, AreaId, Deadline, FixedEvent, SessionContext, SessionLog, Settings, SlotEntry,
 *   SlotKey, Task, TimerState, Week } from './types.js'
 */
import { DAY_IDS, REVIEW_SLOT_KEY, SLOT_IDS, SLOT_KEYS, dayIdOf, isLocalDate, isSlotKey, slotKey } from './calendar.js';

export const SCHEMA_VERSION = 1;

/** @type {readonly AreaId[]} */
export const AREA_IDS = ['independent', 'group', 'careers', 'module-1', 'module-2', 'module-3', 'buffer'];

const MAX_NAME_LENGTH = 80;
const MAX_TEXT_LENGTH = 2000;

export class SchemaError extends Error {
  /**
   * @param {string} path
   * @param {string} expected
   * @param {unknown} got
   */
  constructor(path, expected, got) {
    super(`${path}: expected ${expected}, got ${describe(got)}`);
    this.name = 'SchemaError';
    this.path = path;
  }
}

export class NewerSchemaError extends Error {
  /** @param {number} found */
  constructor(found) {
    super(`saved data is schema version ${found}; this version of Logbook reads up to ${SCHEMA_VERSION}`);
    this.name = 'NewerSchemaError';
    this.found = found;
  }
}

/** @returns {Settings} */
export function defaultSettings() {
  return {
    focusMinutes: 50,
    breakMinutes: 10,
    areas: [
      { id: 'independent', name: 'Independent project', target: 13 },
      { id: 'group', name: 'Group project', target: 8 },
      { id: 'careers', name: 'Grad scheme prep', target: 5 },
      { id: 'module-1', name: 'Module 1', target: 2 },
      { id: 'module-2', name: 'Module 2', target: 2 },
      { id: 'module-3', name: 'Module 3', target: 2 },
      { id: 'buffer', name: 'Buffer', target: 2 },
    ],
    recurring: [],
    theme: 'system',
  };
}

/** @returns {AppState} */
export function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: defaultSettings(),
    weeks: {},
    tasks: [],
    logs: [],
    deadlines: [],
    timer: { phase: 'idle' },
    lastExportOn: null,
  };
}

/**
 * The single entry point for data from outside the process: stored
 * state and imported backups. Upgrades older versions step by step, then
 * validates. Unknown fields are dropped.
 *
 * @param {unknown} raw parsed JSON
 * @returns {AppState}
 */
export function parseState(raw) {
  return validateState(migrate(raw));
}

/**
 * @param {unknown} value
 * @param {string} [path]
 * @returns {Settings}
 */
export function validateSettings(value, path = 'settings') {
  const input = object(value, path);
  const areas = unique(array(input.areas, `${path}.areas`, (item, itemPath) => validateArea(item, itemPath)), `${path}.areas`);
  const missing = AREA_IDS.find((areaId) => !areas.some((area) => area.id === areaId));
  if (missing !== undefined) throw new SchemaError(`${path}.areas`, `an area with id "${missing}"`, undefined);

  const recurring = array(input.recurring, `${path}.recurring`, (item, itemPath) => validateFixedEvent(item, itemPath));
  const taken = new Set();
  recurring.forEach((event, index) => {
    const key = slotKey(event.dayId, event.slotId);
    if (key === REVIEW_SLOT_KEY) throw new SchemaError(`${path}.recurring[${index}]`, 'a slot other than the weekly review', key);
    if (taken.has(key)) throw new SchemaError(`${path}.recurring[${index}]`, 'one fixed event per slot', key);
    taken.add(key);
  });

  return {
    focusMinutes: integer(input.focusMinutes, `${path}.focusMinutes`, 1, 120),
    breakMinutes: integer(input.breakMinutes, `${path}.breakMinutes`, 0, 60),
    areas,
    recurring,
    theme: oneOf(input.theme, `${path}.theme`, /** @type {const} */ (['system', 'light', 'dark'])),
  };
}

/**
 * @param {unknown} raw
 * @returns {unknown} data in the current schema, not yet validated
 */
function migrate(raw) {
  const version = integer(object(raw, 'state').schemaVersion, 'schemaVersion', 1, Number.MAX_SAFE_INTEGER);
  if (version > SCHEMA_VERSION) throw new NewerSchemaError(version);
  // Version 1 is current. Each future version adds one upgrade step here.
  return raw;
}

/**
 * @param {unknown} value
 * @returns {AppState}
 */
function validateState(value) {
  const input = object(value, 'state');
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: validateSettings(input.settings),
    weeks: validateWeeks(input.weeks),
    tasks: unique(array(input.tasks, 'tasks', validateTask), 'tasks'),
    logs: unique(array(input.logs, 'logs', validateLog), 'logs'),
    deadlines: unique(array(input.deadlines, 'deadlines', validateDeadline), 'deadlines'),
    timer: validateTimer(input.timer, 'timer'),
    lastExportOn: nullable(input.lastExportOn, 'lastExportOn', localDate),
  };
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {Area}
 */
function validateArea(value, path) {
  const input = object(value, path);
  return {
    id: areaId(input.id, `${path}.id`),
    name: text(input.name, `${path}.name`, MAX_NAME_LENGTH),
    target: integer(input.target, `${path}.target`, 0, SLOT_KEYS.length),
  };
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {FixedEvent}
 */
function validateFixedEvent(value, path) {
  const input = object(value, path);
  return {
    dayId: oneOf(input.dayId, `${path}.dayId`, DAY_IDS),
    slotId: oneOf(input.slotId, `${path}.slotId`, SLOT_IDS),
    label: text(input.label, `${path}.label`, MAX_NAME_LENGTH),
    areaId: nullable(input.areaId, `${path}.areaId`, areaId),
  };
}

/**
 * @param {unknown} value
 * @returns {Record<string, Week>}
 */
function validateWeeks(value) {
  const input = object(value, 'weeks');
  /** @type {Record<string, Week>} */
  const weeks = {};
  for (const [monday, week] of Object.entries(input)) {
    const path = `weeks[${JSON.stringify(monday)}]`;
    if (!isLocalDate(monday) || dayIdOf(monday) !== 'mon') throw new SchemaError(path, 'a key that is a Monday as YYYY-MM-DD', monday);
    weeks[monday] = { slots: validateSlots(object(week, path).slots, `${path}.slots`) };
  }
  return weeks;
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {Record<SlotKey, SlotEntry>}
 */
function validateSlots(value, path) {
  const input = object(value, path);
  const stray = Object.keys(input).find((key) => !isSlotKey(key));
  if (stray !== undefined) throw new SchemaError(`${path}.${stray}`, 'a library slot such as mon-09', stray);

  /** @type {Partial<Record<SlotKey, SlotEntry>>} */
  const slots = {};
  for (const key of SLOT_KEYS) {
    const entryPath = `${path}.${key}`;
    const entry = validateSlotEntry(input[key], entryPath);
    if ((entry.kind === 'review') !== (key === REVIEW_SLOT_KEY)) {
      throw new SchemaError(entryPath, key === REVIEW_SLOT_KEY ? 'the weekly review' : 'a session or fixed event', entry.kind);
    }
    slots[key] = entry;
  }
  return /** @type {Record<SlotKey, SlotEntry>} */ (slots);
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {SlotEntry}
 */
function validateSlotEntry(value, path) {
  const input = object(value, path);
  const kind = oneOf(input.kind, `${path}.kind`, /** @type {const} */ (['session', 'fixed', 'review']));
  switch (kind) {
    case 'session':
      return { kind, areaId: areaId(input.areaId, `${path}.areaId`), taskId: nullable(input.taskId, `${path}.taskId`, id) };
    case 'fixed':
      return { kind, label: text(input.label, `${path}.label`, MAX_NAME_LENGTH), areaId: nullable(input.areaId, `${path}.areaId`, areaId) };
    case 'review':
      return { kind };
  }
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {Task}
 */
function validateTask(value, path) {
  const input = object(value, path);
  return {
    id: id(input.id, `${path}.id`),
    areaId: areaId(input.areaId, `${path}.areaId`),
    title: text(input.title, `${path}.title`, MAX_TEXT_LENGTH),
    estimate: integer(input.estimate, `${path}.estimate`, 1, 100),
    finishedOn: nullable(input.finishedOn, `${path}.finishedOn`, localDate),
  };
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {SessionLog}
 */
function validateLog(value, path) {
  const input = object(value, path);
  return {
    id: id(input.id, `${path}.id`),
    date: localDate(input.date, `${path}.date`),
    slotKey: nullable(input.slotKey, `${path}.slotKey`, slot),
    areaId: areaId(input.areaId, `${path}.areaId`),
    taskId: nullable(input.taskId, `${path}.taskId`, id),
    startedAt: instant(input.startedAt, `${path}.startedAt`),
    minutes: integer(input.minutes, `${path}.minutes`, 1, 120),
    outcome: oneOf(input.outcome, `${path}.outcome`, /** @type {const} */ (['completed', 'interrupted'])),
    note: string(input.note, `${path}.note`, MAX_TEXT_LENGTH),
  };
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {Deadline}
 */
function validateDeadline(value, path) {
  const input = object(value, path);
  return {
    id: id(input.id, `${path}.id`),
    title: text(input.title, `${path}.title`, MAX_TEXT_LENGTH),
    date: localDate(input.date, `${path}.date`),
    areaId: areaId(input.areaId, `${path}.areaId`),
  };
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {TimerState}
 */
function validateTimer(value, path) {
  const input = object(value, path);
  const phase = oneOf(input.phase, `${path}.phase`, /** @type {const} */ (['idle', 'focus', 'break']));
  switch (phase) {
    case 'idle':
      return { phase };
    case 'focus':
      return { phase, startedAt: instant(input.startedAt, `${path}.startedAt`), context: validateContext(input.context, `${path}.context`) };
    case 'break':
      return { phase, startedAt: instant(input.startedAt, `${path}.startedAt`), breakMinutes: integer(input.breakMinutes, `${path}.breakMinutes`, 0, 60) };
  }
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {SessionContext}
 */
function validateContext(value, path) {
  const input = object(value, path);
  return {
    date: localDate(input.date, `${path}.date`),
    slotKey: nullable(input.slotKey, `${path}.slotKey`, slot),
    areaId: areaId(input.areaId, `${path}.areaId`),
    taskId: nullable(input.taskId, `${path}.taskId`, id),
    focusMinutes: integer(input.focusMinutes, `${path}.focusMinutes`, 1, 120),
    breakMinutes: integer(input.breakMinutes, `${path}.breakMinutes`, 0, 60),
  };
}

/**
 * @template {{ id: string }} T
 * @param {T[]} items
 * @param {string} path
 * @returns {T[]}
 */
function unique(items, path) {
  const seen = new Set();
  items.forEach((item, index) => {
    if (seen.has(item.id)) throw new SchemaError(`${path}[${index}].id`, 'an id not used earlier in the list', item.id);
    seen.add(item.id);
  });
  return items;
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
function object(value, path) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SchemaError(path, 'an object', value);
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @template T
 * @param {unknown} value
 * @param {string} path
 * @param {(item: unknown, path: string) => T} validateItem
 * @returns {T[]}
 */
function array(value, path, validateItem) {
  if (!Array.isArray(value)) throw new SchemaError(path, 'an array', value);
  return value.map((item, index) => validateItem(item, `${path}[${index}]`));
}

/**
 * @template T
 * @param {unknown} value
 * @param {string} path
 * @param {(value: unknown, path: string) => T} validateValue
 * @returns {T | null}
 */
function nullable(value, path, validateValue) {
  return value === null ? null : validateValue(value, path);
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function integer(value, path, min, max) {
  if (!Number.isInteger(value) || /** @type {number} */ (value) < min || /** @type {number} */ (value) > max) {
    throw new SchemaError(path, max === Number.MAX_SAFE_INTEGER ? `integer >= ${min}` : `integer from ${min} to ${max}`, value);
  }
  return /** @type {number} */ (value);
}

/**
 * @template {string} T
 * @param {unknown} value
 * @param {string} path
 * @param {readonly T[]} options
 * @returns {T}
 */
function oneOf(value, path, options) {
  if (!options.includes(/** @type {T} */ (value))) throw new SchemaError(path, `one of ${options.join(', ')}`, value);
  return /** @type {T} */ (value);
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {number} maxLength
 * @returns {string}
 */
function string(value, path, maxLength) {
  if (typeof value !== 'string' || value.length > maxLength) throw new SchemaError(path, `text of at most ${maxLength} characters`, value);
  return value;
}

/**
 * Text that must say something: trimmed and not empty.
 * @param {unknown} value
 * @param {string} path
 * @param {number} maxLength
 * @returns {string}
 */
function text(value, path, maxLength) {
  const trimmed = string(value, path, maxLength).trim();
  if (trimmed === '') throw new SchemaError(path, 'non-empty text', value);
  return trimmed;
}

/** @type {(value: unknown, path: string) => string} */
const id = (value, path) => text(value, path, MAX_NAME_LENGTH);

/** @type {(value: unknown, path: string) => AreaId} */
const areaId = (value, path) => oneOf(value, path, AREA_IDS);

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {SlotKey}
 */
function slot(value, path) {
  if (!isSlotKey(value)) throw new SchemaError(path, 'a library slot such as mon-09', value);
  return value;
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {string}
 */
function localDate(value, path) {
  if (!isLocalDate(value)) throw new SchemaError(path, 'a date as YYYY-MM-DD', value);
  return value;
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {string}
 */
function instant(value, path) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) throw new SchemaError(path, 'an ISO 8601 instant in UTC', value);
  return /** @type {string} */ (value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function describe(value) {
  if (value === undefined) return 'nothing';
  const json = String(JSON.stringify(value));
  return json.length > 60 ? `${json.slice(0, 57)}...` : json;
}
