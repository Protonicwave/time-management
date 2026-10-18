/** @import { AppState, LocalDate } from '../domain/types.js' */
import { parseStateJson } from '../domain/schema.js';

// Two kinds of backup. Export downloads a dated copy on request and works
// everywhere. The mirror rewrites one chosen file after every change, using
// the File System Access API, which Chrome provides on file:// pages.

const MIRROR_DELAY_MS = 1500;
const HANDLE_DB = 'logbook';
const HANDLE_STORE = 'handles';
const HANDLE_KEY = 'mirror';

/**
 * Chrome's permission methods on file handles are not in the DOM typings.
 * @typedef {FileSystemFileHandle & {
 *   queryPermission(descriptor: { mode: 'readwrite' }): Promise<PermissionState>,
 *   requestPermission(descriptor: { mode: 'readwrite' }): Promise<PermissionState>,
 * }} PermissionedHandle
 */

/**
 * @typedef {(options: {
 *   suggestedName: string,
 *   types: { description: string, accept: Record<string, string[]> }[],
 * }) => Promise<PermissionedHandle>} SaveFilePicker
 */

/**
 * unsupported: the browser has no File System Access API.
 * off: supported, no file chosen.
 * reconnect: a file was chosen but the browser wants a click to allow
 * writing again, which Chrome asks for after a restart.
 * failed: the last write failed for a reason other than permission.
 * @typedef {'unsupported' | 'off' | 'on' | 'reconnect' | 'failed'} MirrorStatus
 */

/**
 * @param {AppState} state
 * @returns {string}
 */
export function serialise(state) {
  return JSON.stringify(state, null, 2);
}

/**
 * @param {LocalDate} date
 * @returns {string}
 */
export function backupFileName(date) {
  return `logbook-backup-${date}.json`;
}

/**
 * @param {string} text
 * @param {string} fileName
 */
export function downloadText(text, fileName) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // The click starts the download synchronously, so the URL can go.
  URL.revokeObjectURL(url);
}

/**
 * @param {File} file
 * @returns {Promise<AppState>} throws SchemaError or NewerSchemaError naming what is wrong
 */
export async function readBackupFile(file) {
  return parseStateJson(await file.text());
}

/**
 * @typedef {object} Mirror
 * @property {() => MirrorStatus} status
 * @property {() => string | null} fileName
 * @property {() => string | null} failure the message of the last failed write
 * @property {() => Promise<void>} init
 * @property {(state: AppState) => Promise<void>} choose
 * @property {(state: AppState) => Promise<void>} reconnect
 * @property {(state: AppState) => void} schedule
 */

/**
 * @param {() => void} onStatusChange
 * @returns {Mirror}
 */
export function createMirror(onStatusChange) {
  const picker = /** @type {{ showSaveFilePicker?: SaveFilePicker }} */ (/** @type {unknown} */ (window)).showSaveFilePicker;
  /** @type {MirrorStatus} */
  let status = picker ? 'off' : 'unsupported';
  /** @type {PermissionedHandle | null} */
  let handle = null;
  /** @type {string | null} */
  let failure = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  /** @param {MirrorStatus} next */
  function setStatus(next) {
    if (next === status) return;
    status = next;
    onStatusChange();
  }

  /** @param {AppState} state */
  async function write(state) {
    if (!handle) return;
    try {
      const writable = await handle.createWritable();
      await writable.write(serialise(state));
      await writable.close();
      failure = null;
      setStatus('on');
    } catch (error) {
      if (!(error instanceof DOMException)) throw error;
      console.error('backup file write failed:', error.name, error.message);
      if (error.name === 'NotAllowedError') {
        setStatus('reconnect');
      } else if (status === 'failed') {
        failure = error.message;
        onStatusChange();
      } else {
        failure = error.message;
        setStatus('failed');
      }
    }
  }

  return {
    status: () => status,
    fileName: () => handle?.name ?? null,
    failure: () => failure,

    async init() {
      if (status === 'unsupported') return;
      handle = await readHandle();
      if (!handle) return;
      setStatus((await handle.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'on' : 'reconnect');
    },

    async choose(state) {
      if (!picker) return;
      try {
        handle = await picker({
          suggestedName: 'logbook-backup.json',
          types: [{ description: 'Logbook backup', accept: { 'application/json': ['.json'] } }],
        });
      } catch (error) {
        // Closing the picker is a choice, not a failure.
        if (error instanceof DOMException && error.name === 'AbortError') return;
        throw error;
      }
      await storeHandle(handle);
      await write(state);
    },

    async reconnect(state) {
      if (!handle) return;
      if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
      await write(state);
    },

    schedule(state) {
      if (status !== 'on') return;
      clearTimeout(timer);
      timer = setTimeout(() => void write(state), MIRROR_DELAY_MS);
    },
  };
}

/** @returns {Promise<IDBDatabase>} */
function openHandleDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(HANDLE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** @returns {Promise<PermissionedHandle | null>} */
async function readHandle() {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(HANDLE_STORE).objectStore(HANDLE_STORE).get(HANDLE_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

/** @param {PermissionedHandle} handle */
async function storeHandle(handle) {
  const db = await openHandleDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(HANDLE_STORE, 'readwrite');
    transaction.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}
