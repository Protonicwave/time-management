/** @import { AppState } from '../domain/types.js' */
import { NewerSchemaError, SchemaError, parseStateJson } from '../domain/schema.js';

// Chrome gives every file:// page the same localStorage, so keys carry a
// prefix to stay clear of anything else opened from disk.
export const STATE_KEY = 'logbook:state';
const QUARANTINE_PREFIX = 'logbook:quarantine:';

/** @typedef {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>} KeyValueStorage */

/**
 * @typedef {{ kind: 'empty' }
 *   | { kind: 'loaded', state: AppState }
 *   | { kind: 'quarantined', raw: string, error: SchemaError | NewerSchemaError, quarantineKey: string | null }} LoadResult
 * quarantineKey is null when there was no room for the copy and the raw
 * text is still under STATE_KEY.
 */

export class StorageFullError extends Error {
  /** @param {unknown} cause */
  constructor(cause) {
    super('browser storage is full, so the latest change was not saved', { cause });
    this.name = 'StorageFullError';
  }
}

/**
 * Reads the working copy. Text that cannot be read is moved to a
 * timestamped key rather than left where the next save would overwrite it.
 *
 * @param {KeyValueStorage} storage
 * @param {Date} now names the quarantine key
 * @returns {LoadResult}
 */
export function loadState(storage, now) {
  const raw = storage.getItem(STATE_KEY);
  if (raw === null) return { kind: 'empty' };
  try {
    return { kind: 'loaded', state: parseStateJson(raw) };
  } catch (error) {
    if (!(error instanceof SchemaError || error instanceof NewerSchemaError)) throw error;
    console.error('saved state could not be read:', error.message);
    return { kind: 'quarantined', raw, error, quarantineKey: quarantine(storage, raw, now) };
  }
}

/**
 * @param {KeyValueStorage} storage
 * @param {AppState} state
 */
export function saveState(storage, state) {
  try {
    storage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (error) {
    if (isQuotaError(error)) throw new StorageFullError(error);
    throw error;
  }
}

/**
 * @param {KeyValueStorage} storage
 * @param {string} raw
 * @param {Date} now
 * @returns {string | null}
 */
function quarantine(storage, raw, now) {
  const key = `${QUARANTINE_PREFIX}${now.toISOString()}`;
  try {
    storage.setItem(key, raw);
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    console.error('no room to quarantine unreadable state; it stays under', STATE_KEY);
    return null;
  }
  storage.removeItem(STATE_KEY);
  return key;
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isQuotaError(error) {
  return error instanceof DOMException && error.name === 'QuotaExceededError';
}
