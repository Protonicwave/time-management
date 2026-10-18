import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../src/domain/schema.js';
import { describeDock, entryTitle, isFirstRun, nearestDeadlines, nextSlot, sessionsToGo, slotRows, weekShownOn } from '../src/state/day.js';
import { addDeadline, addTask, advanceTimer, deleteTask, editSlot, ensureWeek, startSession, stopSession, updateSettings } from '../src/state/transitions.js';

/** @import { AppState } from '../src/domain/types.js' */

const monday = '2026-10-19';
const tuesday = '2026-10-20';
// Local times, so dates match whatever timezone runs the tests.
/**
 * @param {number} hour
 * @param {number} [minute]
 * @param {number} [day] day of October 2026
 */
const at = (hour, minute = 0, day = 20) => new Date(2026, 9, day, hour, minute);

/** @returns {AppState} */
function planned() {
  let state = updateSettings(defaultState(), {
    recurring: [
      { dayId: 'tue', slotId: '13', label: 'Group meeting', areaId: 'group' },
      { dayId: 'tue', slotId: '14', label: 'Careers fair', areaId: null },
    ],
  });
  state = addTask(state, { id: 't1', areaId: 'independent', title: 'Draft results section', estimate: 4 });
  state = ensureWeek(state, monday);
  return editSlot(state, monday, 'tue-10', { kind: 'session', areaId: 'independent', taskId: 't1' });
}

/**
 * Runs the timer on a slot from a start time for some minutes.
 * @param {AppState} state
 * @param {import('../src/state/day.js').Session} session
 * @param {Date} start
 * @param {number} minutes
 * @param {string} id
 */
function work(state, session, start, minutes, id) {
  const end = new Date(start.getTime() + minutes * 60_000);
  const started = startSession(state, session, start);
  return minutes >= state.settings.focusMinutes ? advanceTimer(started, end, id) : stopSession(started, end, id);
}

describe('first run and the week shown', () => {
  test('is a first run until a week exists', () => {
    assert.equal(isFirstRun(defaultState()), true);
    assert.equal(isFirstRun(planned()), false);
  });

  test('shows this week on a library day and next week at the weekend', () => {
    assert.equal(weekShownOn(tuesday), monday);
    assert.equal(weekShownOn('2026-10-24'), '2026-10-26');
    assert.equal(weekShownOn('2026-10-25'), '2026-10-26');
  });
});

describe('slot rows', () => {
  test('lists the seven slots of a library day with what the timer would log', () => {
    const rows = slotRows(planned(), tuesday);
    assert.deepEqual(rows.map((row) => row.hour), [9, 10, 11, 13, 14, 15, 16]);
    assert.deepEqual(rows[1]?.session, { slotKey: 'tue-10', areaId: 'independent', taskId: 't1' });
    assert.deepEqual(rows[3]?.session, { slotKey: 'tue-13', areaId: 'group', taskId: null });
    assert.equal(rows[4]?.session, null);
  });

  test('gives the review slot nothing to log', () => {
    const friday = slotRows(planned(), '2026-10-23');
    assert.equal(friday[6]?.entry.kind, 'review');
    assert.equal(friday[6]?.session, null);
  });

  test('is empty at the weekend', () => {
    assert.deepEqual(slotRows(planned(), '2026-10-24'), []);
  });

  test('previews a week not yet created exactly as it will be created', () => {
    const state = planned();
    const nextTuesday = '2026-10-27';
    const created = ensureWeek(state, '2026-10-26');
    assert.deepEqual(slotRows(state, nextTuesday), slotRows(created, nextTuesday));
    assert.equal(state.weeks['2026-10-26'], undefined);
  });

  test('marks completed, stopped and live slots from the day\'s logs only', () => {
    let state = planned();
    const rows = slotRows(state, tuesday);
    const [nine, ten, eleven] = rows.map((row) => /** @type {any} */ (row.session));
    state = work(state, nine, at(9), 50, 'l1');
    state = work(state, ten, at(10), 20, 'l2');
    state = work(state, ten, at(10, 25), 10, 'l3');
    // Last week's Tuesday must not count.
    state = work(state, eleven, at(11, 0, 13), 50, 'old');
    state = startSession(state, eleven, at(11));

    const statuses = slotRows(state, tuesday).map((row) => row.status);
    assert.deepEqual(statuses.slice(0, 4), [
      { status: 'logged', minutes: 50, completed: true },
      { status: 'logged', minutes: 30, completed: false },
      { status: 'live' },
      { status: 'open' },
    ]);
  });
});

describe('next slot', () => {
  test('is the first open slot that has not ended, skipping unlinked fixed events', () => {
    let state = planned();
    assert.equal(nextSlot(slotRows(state, tuesday), at(8, 30))?.key, 'tue-09');
    assert.equal(nextSlot(slotRows(state, tuesday), at(10, 59))?.key, 'tue-10');
    state = work(state, /** @type {any} */ (slotRows(state, tuesday)[1]?.session), at(10), 50, 'l1');
    assert.equal(nextSlot(slotRows(state, tuesday), at(10, 59))?.key, 'tue-11');
    assert.equal(nextSlot(slotRows(state, tuesday), at(14, 10))?.key, 'tue-15');
    assert.equal(nextSlot(slotRows(state, tuesday), at(17)), null);
  });
});

describe('dock', () => {
  test('asks for setup before any week exists', () => {
    assert.deepEqual(describeDock(defaultState(), at(10)), { kind: 'setup' });
  });

  test('names the running session and counts it among the day\'s sessions', () => {
    let state = planned();
    const [nine, ten] = slotRows(state, tuesday).map((row) => /** @type {any} */ (row.session));
    state = startSession(work(state, nine, at(9), 50, 'l1'), ten, at(10));
    assert.deepEqual(describeDock(state, at(10, 5)), { kind: 'focus', number: 2, areaName: 'Independent project', taskTitle: 'Draft results section' });
  });

  test('shows the next slot during a break', () => {
    const state = work(planned(), /** @type {any} */ (slotRows(planned(), tuesday)[1]?.session), at(10), 50, 'l1');
    const dock = describeDock(state, at(10, 55));
    assert.equal(dock.kind, 'break');
    assert.ok(dock.kind === 'break');
    assert.equal(dock.next?.key, 'tue-11');
  });

  test('offers the next slot today, early before its hour', () => {
    const before = describeDock(planned(), at(8, 40));
    assert.ok(before.kind === 'next-today');
    assert.deepEqual([before.row.key, before.early], ['tue-09', true]);
    const during = describeDock(planned(), at(9, 10));
    assert.ok(during.kind === 'next-today');
    assert.equal(during.early, false);
  });

  test('points to the first slot of the next library day once today is done', () => {
    const tuesdayEvening = describeDock(planned(), at(17, 30));
    assert.ok(tuesdayEvening.kind === 'next-day');
    assert.deepEqual([tuesdayEvening.date, tuesdayEvening.row?.key], ['2026-10-21', 'wed-09']);

    const saturday = describeDock(planned(), at(10, 0, 24));
    assert.ok(saturday.kind === 'next-day');
    assert.deepEqual([saturday.date, saturday.row?.key], ['2026-10-26', 'mon-09']);
  });
});

describe('entry titles', () => {
  test('use the task, the fixed label or the area, and survive a deleted task', () => {
    const state = planned();
    const rows = slotRows(state, tuesday);
    assert.equal(entryTitle(state, /** @type {any} */ (rows[1]).entry), 'Draft results section');
    assert.equal(entryTitle(state, /** @type {any} */ (rows[3]).entry), 'Group meeting');
    assert.equal(entryTitle(state, { kind: 'session', areaId: 'buffer', taskId: null }), 'Buffer');
    assert.equal(entryTitle(state, { kind: 'review' }), 'Weekly review');
    assert.equal(entryTitle(deleteTask(state, 't1'), { kind: 'session', areaId: 'independent', taskId: 't1' }), 'Deleted task');
  });
});

describe('sessions to go', () => {
  test('counts loggable slots without a log, including the live one', () => {
    let state = planned();
    const [nine, ten] = slotRows(state, tuesday).map((row) => /** @type {any} */ (row.session));
    assert.equal(sessionsToGo(slotRows(state, tuesday)), 6);
    state = startSession(work(state, nine, at(9), 50, 'l1'), ten, at(10));
    assert.equal(sessionsToGo(slotRows(state, tuesday)), 5);
  });
});

describe('nearest deadlines', () => {
  test('lists the next few from today onwards, soonest first', () => {
    let state = defaultState();
    for (const [id, date] of [['a', '2026-11-06'], ['b', '2026-10-19'], ['c', '2026-10-20'], ['d', '2026-10-30'], ['e', '2026-10-27']]) {
      state = addDeadline(state, { id, title: id, date, areaId: 'group' });
    }
    assert.deepEqual(nearestDeadlines(state.deadlines, tuesday, 3).map((deadline) => deadline.id), ['c', 'e', 'd']);
    assert.deepEqual(nearestDeadlines([], tuesday, 3), []);
  });
});
