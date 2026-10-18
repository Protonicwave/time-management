import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../src/domain/schema.js';
import { StorageFullError } from '../src/storage/local-store.js';
import { addTask, updateSettings } from '../src/state/transitions.js';
import { createStore } from '../src/ui/store.js';

/** @import { AppState } from '../src/domain/types.js' */

const task = { id: 't1', areaId: /** @type {const} */ ('group'), title: 'Write demo script', estimate: 2 };

/** A save function standing in for storage, recording what it was sent. */
function fakeSave() {
  /** @type {AppState[]} */
  const saved = [];
  /** @type {Error | null} */
  let failWith = null;
  return {
    saved,
    /** @param {Error | null} error */
    fail(error) { failWith = error; },
    /** @param {AppState} state */
    save(state) {
      if (failWith) throw failWith;
      saved.push(state);
    },
  };
}

describe('store', () => {
  test('applies a transition with its arguments, saves and notifies', () => {
    const storage = fakeSave();
    const store = createStore(defaultState(), storage.save);
    let notified = 0;
    store.subscribe(() => { notified += 1; });

    store.apply(addTask, task);
    assert.equal(store.state.tasks[0]?.title, 'Write demo script');
    assert.deepEqual(storage.saved, [store.state]);
    assert.equal(notified, 1);
  });

  test('does nothing when a transition returns the same state', () => {
    const storage = fakeSave();
    const store = createStore(defaultState(), storage.save);
    let notified = 0;
    store.subscribe(() => { notified += 1; });
    store.apply((state) => state);
    assert.deepEqual([storage.saved.length, notified], [0, 0]);
  });

  test('keeps a change it could not save, reports it, and clears the report on the next save', () => {
    const storage = fakeSave();
    const store = createStore(defaultState(), storage.save);
    let notified = 0;
    store.subscribe(() => { notified += 1; });

    storage.fail(new StorageFullError(null));
    store.apply(addTask, task);
    assert.equal(store.state.tasks.length, 1);
    assert.ok(store.saveError instanceof StorageFullError);
    assert.equal(notified, 1);

    storage.fail(null);
    store.apply(updateSettings, { theme: 'dark' });
    assert.equal(store.saveError, null);
  });

  test('lets an unnamed save failure propagate after notifying', () => {
    const storage = fakeSave();
    const store = createStore(defaultState(), storage.save);
    let notified = 0;
    store.subscribe(() => { notified += 1; });
    storage.fail(new TypeError('broken'));
    assert.throws(() => store.apply(addTask, task), { name: 'TypeError' });
    assert.equal(notified, 1);
  });

  test('adopts state saved by another tab without saving it again', () => {
    const storage = fakeSave();
    const store = createStore(defaultState(), storage.save);
    const other = addTask(defaultState(), task);
    store.sync(other);
    assert.equal(store.state, other);
    assert.equal(storage.saved.length, 0);
  });
});
