import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { groupDeadlines, isSoon } from '../src/state/deadlines.js';

/** @import { Deadline } from '../src/domain/types.js' */

const today = '2026-10-20';

/**
 * @param {string} id
 * @param {string} date
 * @returns {Deadline}
 */
const deadline = (id, date) => ({ id, title: id, date, areaId: 'group' });

describe('groupDeadlines', () => {
  test('splits into the next 14 days, later and past, each soonest first', () => {
    const groups = groupDeadlines([
      deadline('later', '2026-11-13'),
      deadline('fortnight', '2026-11-03'),
      deadline('today', '2026-10-20'),
      deadline('just-later', '2026-11-04'),
      deadline('yesterday', '2026-10-19'),
      deadline('last-month', '2026-09-30'),
      deadline('next-week', '2026-10-27'),
    ], today);

    assert.deepEqual(groups.next.map((item) => [item.deadline.id, item.days]), [['today', 0], ['next-week', 7], ['fortnight', 14]]);
    assert.deepEqual(groups.later.map((item) => [item.deadline.id, item.days]), [['just-later', 15], ['later', 24]]);
    // Past runs most recent first, as the latest miss matters most.
    assert.deepEqual(groups.past.map((item) => [item.deadline.id, item.days]), [['yesterday', -1], ['last-month', -20]]);
  });

  test('keeps deadlines on the same date in the order they were added', () => {
    const groups = groupDeadlines([deadline('first', '2026-10-22'), deadline('second', '2026-10-22')], today);
    assert.deepEqual(groups.next.map((item) => item.deadline.id), ['first', 'second']);
  });

  test('counts days across a clock change by calendar date', () => {
    assert.equal(groupDeadlines([deadline('after', '2026-10-26')], '2026-10-24').next[0]?.days, 2);
  });

  test('has nothing in any group with no deadlines', () => {
    assert.deepEqual(groupDeadlines([], today), { next: [], later: [], past: [] });
  });
});

describe('isSoon', () => {
  test('is a week or less away, and not past', () => {
    assert.equal(isSoon(0), true);
    assert.equal(isSoon(7), true);
    assert.equal(isSoon(8), false);
    assert.equal(isSoon(-1), false);
  });
});
