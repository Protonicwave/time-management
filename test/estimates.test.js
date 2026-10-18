import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { correctionFactor, likelyRemaining, loggedSessionsByTask } from '../src/domain/estimates.js';

/** @import { SessionLog, Task } from '../src/domain/types.js' */

let nextLogId = 0;

/**
 * @param {string | null} taskId
 * @param {number} minutes
 * @returns {SessionLog}
 */
function log(taskId, minutes) {
  return {
    id: `log-${(nextLogId += 1)}`, date: '2026-10-19', slotKey: 'mon-09', areaId: 'independent', taskId,
    startedAt: '2026-10-19T08:00:00.000Z', minutes, outcome: minutes === 50 ? 'completed' : 'interrupted', note: '',
  };
}

/**
 * @param {string} id
 * @param {number} estimate
 * @param {string | null} finishedOn
 * @returns {Task}
 */
function task(id, estimate, finishedOn = null) {
  return { id, areaId: 'independent', title: id, estimate, finishedOn };
}

describe('loggedSessionsByTask', () => {
  test('counts minutes as fractions of the focus length and skips logs without a task', () => {
    const logged = loggedSessionsByTask([log('a', 50), log('a', 25), log(null, 50), log('b', 10)], 50);
    assert.deepEqual(Object.fromEntries(logged), { a: 1.5, b: 0.2 });
  });
});

describe('correctionFactor', () => {
  test('is total logged over total estimate across finished tasks', () => {
    const logged = new Map([['a', 4.2], ['b', 2.4], ['c', 1], ['open', 9]]);
    const tasks = [task('a', 3, '2026-10-19'), task('b', 2, '2026-10-20'), task('c', 1, '2026-10-21'), task('open', 2)];
    assert.equal(correctionFactor(tasks, logged), (4.2 + 2.4 + 1) / 6);
  });

  test('leaves out finished tasks with nothing logged', () => {
    const tasks = [task('a', 2, '2026-10-19'), task('b', 5, '2026-10-19')];
    assert.equal(correctionFactor(tasks, new Map([['a', 3]])), 1.5);
  });

  test('returns null when no finished task has logged work', () => {
    assert.equal(correctionFactor([], new Map()), null);
    assert.equal(correctionFactor([task('a', 2)], new Map([['a', 1]])), null);
    assert.equal(correctionFactor([task('a', 2, '2026-10-19')], new Map()), null);
  });
});

describe('likelyRemaining', () => {
  test('scales the estimate by the factor before subtracting logged work', () => {
    const logged = new Map([['a', 2.6]]);
    assert.ok(Math.abs(likelyRemaining(task('a', 4), logged, 1.4) - 3) < 1e-9);
    assert.ok(Math.abs(likelyRemaining(task('b', 3), logged, 1.4) - 4.2) < 1e-9);
  });

  test('uses the raw estimate without a factor', () => {
    assert.equal(likelyRemaining(task('a', 3), new Map([['a', 1]]), null), 2);
  });

  test('is zero once logged work reaches the adjusted estimate', () => {
    assert.equal(likelyRemaining(task('a', 1), new Map([['a', 2]]), 1.4), 0);
  });
});
