import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewWeekOn, weekVerdict } from '../src/state/week-review.js';

/** @import { AreaRow } from '../src/domain/review.js' */
/** @import { AreaId } from '../src/domain/types.js' */

/**
 * @param {[AreaId, number, number][]} rows area, planned, logged
 * @returns {AreaRow[]}
 */
const rows = (...rows) => rows.map(([areaId, planned, logged]) => ({ areaId, planned, logged }));

describe('reviewWeekOn', () => {
  test('opens on last week until Friday, then on this week through the weekend', () => {
    assert.equal(reviewWeekOn('2026-10-19'), '2026-10-12');
    assert.equal(reviewWeekOn('2026-10-22'), '2026-10-12');
    assert.equal(reviewWeekOn('2026-10-23'), '2026-10-19');
    assert.equal(reviewWeekOn('2026-10-25'), '2026-10-19');
  });
});

describe('weekVerdict', () => {
  test('names the largest shortfall and the first area that got everything it was given', () => {
    const verdict = weekVerdict(rows(['independent', 13, 13.2], ['group', 8, 5], ['careers', 5, 4.6], ['buffer', 2, 1.4]));
    assert.deepEqual(verdict, { kind: 'short', areaId: 'group', sessions: 3, met: 'independent' });
  });

  test('breaks a tie between shortfalls by area priority', () => {
    assert.deepEqual(weekVerdict(rows(['independent', 4, 2], ['group', 4, 2])), { kind: 'short', areaId: 'independent', sessions: 2, met: null });
  });

  test('ignores areas with nothing planned when looking for one that got everything', () => {
    assert.equal(weekVerdict(rows(['independent', 0, 0], ['group', 4, 1], ['careers', 2, 2])).met, 'careers');
  });

  test('says no area ran a full session short when the gaps are all smaller', () => {
    assert.deepEqual(weekVerdict(rows(['independent', 13, 12.4], ['group', 8, 8])), { kind: 'close' });
  });

  test('says every area got its sessions when nothing fell short', () => {
    assert.deepEqual(weekVerdict(rows(['independent', 13, 13], ['group', 0, 1])), { kind: 'met' });
  });
});
