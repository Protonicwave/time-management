/** @import { AppState } from '../domain/types.js' */
import { StorageFullError } from '../storage/local-store.js';

/**
 * @typedef {object} Store
 * @property {AppState} state
 * @property {StorageFullError | null} saveError set while the latest change is held in memory only
 * @property {<A extends unknown[]>(transition: (state: AppState, ...args: A) => AppState, ...args: A) => void} apply
 * @property {(state: AppState) => void} sync adopts state another tab has already saved
 * @property {(listener: () => void) => void} subscribe
 */

/**
 * The one place the running state lives. A change that cannot be saved is
 * kept in memory so it can still be exported.
 *
 * @param {AppState} initial
 * @param {(state: AppState) => void} save throws StorageFullError when storage is full
 * @returns {Store}
 */
export function createStore(initial, save) {
  let state = initial;
  /** @type {StorageFullError | null} */
  let saveError = null;
  /** @type {(() => void)[]} */
  const listeners = [];
  const notify = () => listeners.forEach((listener) => listener());

  return {
    get state() {
      return state;
    },
    get saveError() {
      return saveError;
    },
    apply(transition, ...args) {
      const next = transition(state, ...args);
      if (next === state) return;
      state = next;
      try {
        save(state);
        saveError = null;
      } catch (error) {
        if (!(error instanceof StorageFullError)) throw error;
        console.error(error.message);
        saveError = error;
      } finally {
        notify();
      }
    },
    sync(next) {
      state = next;
      notify();
    },
    subscribe(listener) {
      listeners.push(listener);
    },
  };
}
