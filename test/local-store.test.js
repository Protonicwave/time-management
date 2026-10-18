import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { NewerSchemaError, SchemaError, defaultState } from '../src/domain/schema.js';
import { STATE_KEY, StorageFullError, loadState, saveState } from '../src/storage/local-store.js';
import { addTask } from '../src/state/transitions.js';

const now = new Date('2026-10-20T09:15:00.000Z');
const quarantineKey = 'logbook:quarantine:2026-10-20T09:15:00.000Z';

/** Stands in for localStorage at the I/O boundary. */
class FakeStorage {
  /** @param {Record<string, string>} [items] */
  constructor(items = {}) {
    this.items = new Map(Object.entries(items));
    /** @type {(key: string) => boolean} */
    this.full = () => false;
  }

  /** @param {string} key */
  getItem(key) {
    return this.items.get(key) ?? null;
  }

  /**
   * @param {string} key
   * @param {string} value
   */
  setItem(key, value) {
    if (this.full(key)) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    this.items.set(key, value);
  }

  /** @param {string} key */
  removeItem(key) {
    this.items.delete(key);
  }
}

describe('saving and loading', () => {
  test('reads back exactly what was saved', () => {
    const storage = new FakeStorage();
    const state = addTask(defaultState(), { id: 't1', areaId: 'group', title: 'Write demo script', estimate: 2 });
    saveState(storage, state);
    assert.deepEqual([...storage.items.keys()], [STATE_KEY]);
    assert.deepEqual(loadState(storage, now), { kind: 'loaded', state });
  });

  test('reports empty storage as a first run', () => {
    assert.deepEqual(loadState(new FakeStorage(), now), { kind: 'empty' });
  });

  test('surfaces a full quota as a named error and leaves the saved copy alone', () => {
    const storage = new FakeStorage({ [STATE_KEY]: 'previous' });
    storage.full = () => true;
    assert.throws(() => saveState(storage, defaultState()), (error) =>
      error instanceof StorageFullError && /browser storage is full/.test(error.message));
    assert.equal(storage.getItem(STATE_KEY), 'previous');
  });

  test('lets other storage failures propagate unchanged', () => {
    const storage = new FakeStorage();
    storage.setItem = () => { throw new DOMException('denied', 'SecurityError'); };
    assert.throws(() => saveState(storage, defaultState()), { name: 'SecurityError' });
  });
});

describe('quarantine', () => {
  test('moves unparseable text aside instead of overwriting it', () => {
    const storage = new FakeStorage({ [STATE_KEY]: '{"schemaVersion": 1, "settings"' });
    const result = loadState(storage, now);
    assert.equal(result.kind, 'quarantined');
    assert.ok(result.kind === 'quarantined');
    assert.equal(result.quarantineKey, quarantineKey);
    assert.equal(result.raw, '{"schemaVersion": 1, "settings"');
    assert.ok(result.error instanceof SchemaError);
    assert.deepEqual(Object.fromEntries(storage.items), { [quarantineKey]: '{"schemaVersion": 1, "settings"' });
  });

  test('quarantines state that fails validation, keeping the path in the error', () => {
    const raw = JSON.parse(JSON.stringify(defaultState()));
    raw.settings.focusMinutes = 0;
    const storage = new FakeStorage({ [STATE_KEY]: JSON.stringify(raw) });
    const result = loadState(storage, now);
    assert.ok(result.kind === 'quarantined');
    assert.equal(result.error.message, 'settings.focusMinutes: expected integer from 1 to 120, got 0');
    assert.equal(storage.getItem(STATE_KEY), null);
  });

  test('quarantines state from a newer version of the app', () => {
    const storage = new FakeStorage({ [STATE_KEY]: JSON.stringify({ ...defaultState(), schemaVersion: 2 }) });
    const result = loadState(storage, now);
    assert.ok(result.kind === 'quarantined');
    assert.ok(result.error instanceof NewerSchemaError);
  });

  test('keeps the original in place when there is no room for the copy', () => {
    const storage = new FakeStorage({ [STATE_KEY]: 'not json' });
    storage.full = (key) => key !== STATE_KEY;
    const result = loadState(storage, now);
    assert.ok(result.kind === 'quarantined');
    assert.equal(result.quarantineKey, null);
    assert.deepEqual(Object.fromEntries(storage.items), { [STATE_KEY]: 'not json' });
  });
});
