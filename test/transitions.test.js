import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, parseState } from '../src/domain/schema.js';
import {
  addDeadline,
  addTask,
  advanceTimer,
  deleteDeadline,
  deleteTask,
  editDeadline,
  editSlot,
  editTask,
  ensureWeek,
  noteLog,
  regenerateWeek,
  setTaskFinished,
  startSession,
  stopSession,
  updateSettings,
} from '../src/state/transitions.js';

/** @import { AppState, Week } from '../src/domain/types.js' */

const monday = '2026-10-19';
// Local times, so the session date matches whatever timezone runs the tests.
const tuesdayTen = new Date(2026, 9, 20, 10, 0);
/** @param {number} minutes */
const after = (minutes) => new Date(tuesdayTen.getTime() + minutes * 60_000);

/** @returns {AppState} */
function withTask() {
  return addTask(defaultState(), { id: 't1', areaId: 'independent', title: 'Draft results section', estimate: 4 });
}

/**
 * @param {AppState} state
 * @returns {Week}
 */
function weekOf(state) {
  const week = state.weeks[monday];
  assert.ok(week, 'week exists');
  return week;
}

describe('weeks', () => {
  test('creates a week once, from the recurring events', () => {
    const settings = updateSettings(defaultState(), {
      recurring: [{ dayId: 'tue', slotId: '13', label: 'Group meeting', areaId: 'group' }],
    });
    const state = ensureWeek(settings, monday);
    assert.deepEqual(weekOf(state).slots['tue-13'], { kind: 'fixed', label: 'Group meeting', areaId: 'group' });
    assert.equal(ensureWeek(state, monday), state);
  });

  test('edits one slot, creating the week if needed', () => {
    const state = editSlot(withTask(), monday, 'wed-14', { kind: 'session', areaId: 'independent', taskId: 't1' });
    assert.deepEqual(weekOf(state).slots['wed-14'], { kind: 'session', areaId: 'independent', taskId: 't1' });
  });

  test('refuses to edit the review slot, a blank fixed label or an unknown task', () => {
    const state = defaultState();
    assert.throws(() => editSlot(state, monday, 'fri-16', { kind: 'fixed', label: 'Pub', areaId: null }), /reserved for the weekly review/);
    assert.throws(() => editSlot(state, monday, 'mon-09', { kind: 'fixed', label: '  ', areaId: null }), {
      message: 'slot mon-09.label: expected non-empty text, got "  "',
    });
    assert.throws(() => editSlot(state, monday, 'mon-09', { kind: 'session', areaId: 'group', taskId: 'nope' }), { name: 'UnknownIdError' });
  });

  test('regenerates sessions from new targets, keeping one-off fixed events', () => {
    let state = editSlot(ensureWeek(defaultState(), monday), monday, 'thu-14', { kind: 'fixed', label: 'Supervisor', areaId: 'independent' });
    const areas = state.settings.areas.map((area) => (area.id === 'buffer' ? { ...area, target: 0 } : area.id === 'module-1' ? { ...area, target: 4 } : area));
    state = regenerateWeek(updateSettings(state, { areas }), monday);
    const slots = weekOf(state).slots;
    assert.deepEqual(slots['thu-14'], { kind: 'fixed', label: 'Supervisor', areaId: 'independent' });
    const module1 = Object.values(slots).filter((entry) => entry.kind === 'session' && entry.areaId === 'module-1');
    assert.equal(module1.length, 4);
  });

  test('regenerating a week never opened creates it', () => {
    assert.ok(regenerateWeek(defaultState(), monday).weeks[monday]);
  });
});

describe('sessions', () => {
  test('logs a completed session when the timer advances past focus', () => {
    let state = startSession(withTask(), { slotKey: 'tue-10', areaId: 'independent', taskId: 't1' }, tuesdayTen);
    assert.equal(state.timer.phase, 'focus');

    const unchanged = advanceTimer(state, after(10), 'unused');
    assert.equal(unchanged, state);

    state = advanceTimer(state, after(50), 'l1');
    assert.equal(state.timer.phase, 'break');
    assert.deepEqual(state.logs, [{
      id: 'l1', date: '2026-10-20', slotKey: 'tue-10', areaId: 'independent', taskId: 't1',
      startedAt: tuesdayTen.toISOString(), minutes: 50, outcome: 'completed', note: '',
    }]);

    state = advanceTimer(state, after(60), 'unused');
    assert.equal(state.timer.phase, 'idle');
    assert.equal(state.logs.length, 1);
  });

  test('logs an early stop as interrupted and an instant stop not at all', () => {
    const running = startSession(defaultState(), { slotKey: null, areaId: 'group', taskId: null }, tuesdayTen);
    const stopped = stopSession(running, after(31), 'l1');
    assert.equal(stopped.timer.phase, 'idle');
    assert.equal(stopped.logs[0]?.outcome, 'interrupted');
    assert.equal(stopped.logs[0]?.minutes, 31);
    assert.equal(stopped.logs[0]?.slotKey, null);
    assert.deepEqual(stopSession(running, after(0.5), 'l1').logs, []);
  });

  test('keeps the start date for a session that runs past midnight', () => {
    const lateStart = new Date(2026, 9, 20, 23, 30);
    const state = startSession(defaultState(), { slotKey: null, areaId: 'careers', taskId: null }, lateStart);
    const logged = advanceTimer(state, new Date(2026, 9, 21, 0, 25), 'l1');
    assert.equal(logged.logs[0]?.date, '2026-10-20');
  });

  test('keeps the focus length a session started with', () => {
    let state = startSession(defaultState(), { slotKey: null, areaId: 'careers', taskId: null }, tuesdayTen);
    state = updateSettings(state, { focusMinutes: 25 });
    assert.equal(advanceTimer(state, after(25), 'l1').logs.length, 0);
    assert.equal(advanceTimer(state, after(50), 'l1').logs[0]?.minutes, 50);
  });

  test('refuses to start twice or for an unknown task', () => {
    const running = startSession(defaultState(), { slotKey: null, areaId: 'group', taskId: null }, tuesdayTen);
    assert.throws(() => startSession(running, { slotKey: null, areaId: 'group', taskId: null }, after(1)), { name: 'TimerStateError' });
    assert.throws(() => startSession(defaultState(), { slotKey: null, areaId: 'group', taskId: 'nope' }, tuesdayTen), {
      message: 'no task with id "nope"',
    });
  });

  test('refuses to reuse a log id', () => {
    let state = startSession(defaultState(), { slotKey: null, areaId: 'group', taskId: null }, tuesdayTen);
    state = stopSession(state, after(20), 'l1');
    state = startSession(state, { slotKey: null, areaId: 'group', taskId: null }, after(30));
    assert.throws(() => stopSession(state, after(50), 'l1'), { name: 'DuplicateIdError' });
  });

  test('adds a trimmed note after a session and finishes its task', () => {
    let state = startSession(withTask(), { slotKey: 'tue-10', areaId: 'independent', taskId: 't1' }, tuesdayTen);
    state = advanceTimer(state, after(50), 'l1');
    state = noteLog(state, 'l1', '  Results section drafted  ');
    state = setTaskFinished(state, 't1', '2026-10-20');
    assert.equal(state.logs[0]?.note, 'Results section drafted');
    assert.equal(state.tasks[0]?.finishedOn, '2026-10-20');
    assert.equal(setTaskFinished(state, 't1', null).tasks[0]?.finishedOn, null);
    assert.throws(() => noteLog(state, 'nope', 'x'), { message: 'no session log with id "nope"' });
  });
});

describe('tasks', () => {
  test('adds, edits and validates tasks', () => {
    let state = withTask();
    assert.deepEqual(state.tasks, [{ id: 't1', areaId: 'independent', title: 'Draft results section', estimate: 4, finishedOn: null }]);
    state = editTask(state, 't1', { estimate: 5, title: ' Draft results ' });
    assert.equal(state.tasks[0]?.estimate, 5);
    assert.equal(state.tasks[0]?.title, 'Draft results');
    assert.throws(() => editTask(state, 't1', { estimate: 0 }), { message: 'task.estimate: expected integer from 1 to 100, got 0' });
    assert.throws(() => addTask(state, { id: 't2', areaId: 'group', title: '', estimate: 1 }), { message: 'task.title: expected non-empty text, got ""' });
    assert.throws(() => addTask(state, { id: 't1', areaId: 'group', title: 'Again', estimate: 1 }), { name: 'DuplicateIdError' });
  });

  test('deleting a task clears it from slots and keeps its logs', () => {
    let state = editSlot(withTask(), monday, 'tue-10', { kind: 'session', areaId: 'independent', taskId: 't1' });
    state = startSession(state, { slotKey: 'tue-10', areaId: 'independent', taskId: 't1' }, tuesdayTen);
    state = advanceTimer(state, after(50), 'l1');
    state = deleteTask(state, 't1');
    assert.deepEqual(state.tasks, []);
    assert.deepEqual(weekOf(state).slots['tue-10'], { kind: 'session', areaId: 'independent', taskId: null });
    assert.equal(state.logs[0]?.taskId, 't1');
    assert.throws(() => deleteTask(state, 't1'), { name: 'UnknownIdError' });
  });
});

describe('deadlines', () => {
  test('adds, edits and deletes deadlines', () => {
    let state = addDeadline(defaultState(), { id: 'd1', title: 'Coursework 1', date: '2026-11-06', areaId: 'module-1' });
    state = editDeadline(state, 'd1', { date: '2026-11-13' });
    assert.deepEqual(state.deadlines, [{ id: 'd1', title: 'Coursework 1', date: '2026-11-13', areaId: 'module-1' }]);
    assert.throws(() => editDeadline(state, 'd1', { date: '2026-11-31' }), { message: 'deadline.date: expected a date as YYYY-MM-DD, got "2026-11-31"' });
    assert.deepEqual(deleteDeadline(state, 'd1').deadlines, []);
    assert.throws(() => deleteDeadline(state, 'd2'), { message: 'no deadline with id "d2"' });
  });
});

describe('settings', () => {
  test('updates settings through the same validation as stored data', () => {
    assert.equal(updateSettings(defaultState(), { theme: 'dark' }).settings.theme, 'dark');
    assert.throws(() => updateSettings(defaultState(), { breakMinutes: 61 }), {
      message: 'settings.breakMinutes: expected integer from 0 to 60, got 61',
    });
  });
});

describe('state stays valid', () => {
  test('a full day of actions survives a save and load unchanged', () => {
    let state = updateSettings(defaultState(), { recurring: [{ dayId: 'tue', slotId: '13', label: 'Group meeting', areaId: 'group' }] });
    state = ensureWeek(addTask(state, { id: 't1', areaId: 'independent', title: 'Draft', estimate: 2 }), monday);
    state = editSlot(state, monday, 'tue-10', { kind: 'session', areaId: 'independent', taskId: 't1' });
    state = startSession(state, { slotKey: 'tue-10', areaId: 'independent', taskId: 't1' }, tuesdayTen);
    state = advanceTimer(state, after(50), 'l1');
    state = noteLog(state, 'l1', 'Done');
    state = startSession(state, { slotKey: null, areaId: 'careers', taskId: null }, after(55));
    state = stopSession(state, after(80), 'l2');
    state = setTaskFinished(state, 't1', '2026-10-20');
    state = addDeadline(state, { id: 'd1', title: 'Coursework 1', date: '2026-11-06', areaId: 'module-1' });
    state = startSession(state, { slotKey: 'tue-14', areaId: 'careers', taskId: null }, after(240));
    assert.deepEqual(parseState(JSON.parse(JSON.stringify(state))), state);
  });
});
