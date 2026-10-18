import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../src/domain/schema.js';
import { estimateLearning, taskGroups } from '../src/state/tasks.js';
import { addTask, advanceTimer, setTaskFinished, startSession, stopSession } from '../src/state/transitions.js';

/** @import { AppState, AreaId } from '../src/domain/types.js' */

// Tuesday of the week of 19 October 2026.
const today = '2026-10-20';

/**
 * Logs whole or partial sessions against a task.
 * @param {AppState} state
 * @param {string} taskId
 * @param {AreaId} areaId
 * @param {number} minutes
 * @param {string} id
 */
function log(state, taskId, areaId, minutes, id) {
  const start = new Date(2026, 9, 19, 9, 0);
  const end = new Date(start.getTime() + minutes * 60_000);
  const started = startSession(state, { slotKey: null, areaId, taskId }, start);
  return minutes >= 50 ? advanceTimer(started, end, id) : stopSession(started, end, id);
}

describe('taskGroups', () => {
  test('lists every area except the buffer, in priority order', () => {
    const groups = taskGroups(defaultState(), today);
    assert.deepEqual(groups.map((group) => group.areaId), ['independent', 'group', 'careers', 'module-1', 'module-2', 'module-3']);
    assert.ok(groups.every((group) => group.open.length === 0 && group.recent.length === 0 && group.earlier.length === 0));
  });

  test('shows the buffer once it has a task', () => {
    const state = addTask(defaultState(), { id: 'b1', areaId: 'buffer', title: 'Catch up', estimate: 1 });
    assert.equal(taskGroups(state, today).at(-1)?.areaId, 'buffer');
  });

  test('keeps tasks finished this week in view and folds away earlier ones, newest first', () => {
    let state = defaultState();
    for (const id of ['open', 'this-week', 'old', 'older']) state = addTask(state, { id, areaId: 'independent', title: id, estimate: 2 });
    state = setTaskFinished(state, 'this-week', '2026-10-19');
    state = setTaskFinished(state, 'older', '2026-10-02');
    state = setTaskFinished(state, 'old', '2026-10-16');

    const group = taskGroups(state, today)[0];
    assert.deepEqual(group?.open.map((row) => row.task.id), ['open']);
    assert.deepEqual(group?.recent.map((row) => row.task.id), ['this-week']);
    assert.deepEqual(group?.earlier.map((row) => row.task.id), ['old', 'older']);
  });

  test('adjusts what is likely left by the correction factor and flags work past it', () => {
    let state = defaultState();
    state = addTask(state, { id: 'done', areaId: 'group', title: 'Done', estimate: 2 });
    state = addTask(state, { id: 'fresh', areaId: 'group', title: 'Fresh', estimate: 3 });
    state = addTask(state, { id: 'over', areaId: 'group', title: 'Over', estimate: 1 });
    // Two sessions estimated, three taken: a factor of 1.5.
    state = log(state, 'done', 'group', 50, 'l1');
    state = log(state, 'done', 'group', 50, 'l2');
    state = log(state, 'done', 'group', 50, 'l3');
    state = setTaskFinished(state, 'done', '2026-10-19');
    state = log(state, 'over', 'group', 50, 'l4');
    state = log(state, 'over', 'group', 25, 'l5');

    const group = taskGroups(state, today)[1];
    const fresh = group?.open.find((row) => row.task.id === 'fresh');
    const over = group?.open.find((row) => row.task.id === 'over');
    assert.deepEqual(fresh?.left, { kind: 'left', sessions: 4.5 });
    assert.equal(over?.logged, 1.5);
    assert.deepEqual(over?.left, { kind: 'over' });
    assert.deepEqual(group?.recent[0]?.left, { kind: 'done' });
  });

  test('counts logs of a task towards it whatever area they were logged under', () => {
    let state = addTask(defaultState(), { id: 't', areaId: 'careers', title: 'Read', estimate: 2 });
    state = log(state, 't', 'buffer', 50, 'l1');
    assert.equal(taskGroups(state, today)[2]?.open[0]?.logged, 1);
  });
});

describe('estimateLearning', () => {
  test('has nothing to say until a finished task has logged work', () => {
    let state = addTask(defaultState(), { id: 't', areaId: 'group', title: 'Done elsewhere', estimate: 2 });
    state = setTaskFinished(state, 't', today);
    assert.deepEqual(estimateLearning(state), { factor: null, basis: 0 });
  });

  test('reports the factor and how many finished tasks it rests on', () => {
    let state = defaultState();
    state = addTask(state, { id: 'a', areaId: 'group', title: 'A', estimate: 1 });
    state = addTask(state, { id: 'b', areaId: 'group', title: 'B', estimate: 1 });
    state = addTask(state, { id: 'open', areaId: 'group', title: 'Open', estimate: 1 });
    state = log(state, 'a', 'group', 50, 'l1');
    state = log(state, 'b', 'group', 50, 'l2');
    state = log(state, 'b', 'group', 50, 'l3');
    state = log(state, 'open', 'group', 50, 'l4');
    state = setTaskFinished(state, 'a', today);
    state = setTaskFinished(state, 'b', today);
    assert.deepEqual(estimateLearning(state), { factor: 1.5, basis: 2 });
  });
});
