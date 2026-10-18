import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fixedEntriesFrom, generateWeek } from '../src/domain/allocation.js';
import { DAY_IDS, SLOT_KEYS, parseSlotKey } from '../src/domain/calendar.js';

/** @import { Area, AreaId, FixedEntry, SlotEntry, SlotKey } from '../src/domain/types.js' */

/**
 * @param {Partial<Record<AreaId, number>>} targets
 * @returns {Area[]}
 */
function areasWith(targets = {}) {
  /** @type {[AreaId, number][]} */
  const defaults = [
    ['independent', 13], ['group', 8], ['careers', 5],
    ['module-1', 2], ['module-2', 2], ['module-3', 2], ['buffer', 2],
  ];
  return defaults.map(([id, target]) => ({ id, name: id, target: targets[id] ?? target }));
}

/**
 * @param {Record<SlotKey, SlotEntry>} slots
 * @param {(entry: SlotEntry) => boolean} [predicate]
 * @returns {Map<string, number>}
 */
function sessionsPerArea(slots, predicate = (entry) => entry.kind === 'session') {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const entry of Object.values(slots)) {
    if (predicate(entry) && entry.kind === 'session') counts.set(entry.areaId, (counts.get(entry.areaId) ?? 0) + 1);
  }
  return counts;
}

/** @type {(label: string, areaId: AreaId | null) => FixedEntry} */
const fixedEntry = (label, areaId) => ({ kind: 'fixed', label, areaId });

describe('generateWeek', () => {
  test('fills every slot, with the review on Friday afternoon', () => {
    const slots = generateWeek(areasWith(), {});
    assert.deepEqual(Object.keys(slots).sort(), [...SLOT_KEYS].sort());
    assert.deepEqual(slots['fri-16'], { kind: 'review' });
    const reviews = Object.values(slots).filter((entry) => entry.kind === 'review');
    assert.equal(reviews.length, 1);
  });

  test('meets every target when they sum to the capacity', () => {
    const counts = sessionsPerArea(generateWeek(areasWith(), {}));
    assert.deepEqual(Object.fromEntries(counts), {
      independent: 13, group: 8, careers: 5, 'module-1': 2, 'module-2': 2, 'module-3': 2, buffer: 2,
    });
  });

  test('credits a fixed event to its area and places one fewer session', () => {
    const slots = generateWeek(areasWith(), { 'tue-13': fixedEntry('Group meeting', 'group') });
    assert.deepEqual(slots['tue-13'], fixedEntry('Group meeting', 'group'));
    const counts = sessionsPerArea(slots);
    assert.equal(counts.get('group'), 7);
    assert.equal(counts.get('independent'), 13);
    assert.equal(counts.get('buffer'), 2);
  });

  test('does not let a fixed event replace the review', () => {
    const slots = generateWeek(areasWith(), { 'fri-16': fixedEntry('Seminar', null) });
    assert.deepEqual(slots['fri-16'], { kind: 'review' });
  });

  test('cuts the buffer first when fixed events take capacity', () => {
    const slots = generateWeek(areasWith(), {
      'mon-14': fixedEntry('Careers fair', null),
      'wed-15': fixedEntry('Supervisor', null),
    });
    const counts = sessionsPerArea(slots);
    assert.equal(counts.get('buffer') ?? 0, 0);
    assert.equal(counts.get('independent'), 13);
    assert.equal(counts.get('module-3'), 2);
  });

  test('scales the rest by largest remainder once the buffer is gone, earlier areas winning ties', () => {
    // 14 free slots against 28 sessions of need: exact shares are 6.5, 4, 2.5, 1, 0, 0.
    /** @type {Partial<Record<SlotKey, FixedEntry>>} */
    const fixed = {};
    for (const key of SLOT_KEYS.slice(0, 20)) fixed[key] = fixedEntry('Away', null);
    const slots = generateWeek(areasWith({ independent: 13, group: 8, careers: 5, 'module-1': 2, 'module-2': 0, 'module-3': 0 }), fixed);
    const counts = sessionsPerArea(slots);
    assert.deepEqual(Object.fromEntries(counts), { independent: 7, group: 4, careers: 2, 'module-1': 1 });
  });

  test('gives spare capacity to the buffer', () => {
    const counts = sessionsPerArea(generateWeek(areasWith({ independent: 3 }), {}));
    assert.equal(counts.get('independent'), 3);
    assert.equal(counts.get('buffer'), 12);
  });

  test('ignores a negative remainder when a fixed event overshoots a target', () => {
    const slots = generateWeek(areasWith({ 'module-1': 1 }), {
      'mon-09': fixedEntry('Lecture', 'module-1'),
      'tue-09': fixedEntry('Lecture', 'module-1'),
    });
    const counts = sessionsPerArea(slots);
    assert.equal(counts.get('module-1') ?? 0, 0);
    assert.equal([...counts.values()].reduce((a, b) => a + b, 0), 32);
  });

  test('spreads each area evenly across the days', () => {
    const slots = generateWeek(areasWith(), {});
    for (const areaId of ['independent', 'group', 'module-1', 'module-2', 'module-3']) {
      const perDay = DAY_IDS.map((dayId) =>
        Object.entries(slots).filter(([key, entry]) =>
          parseSlotKey(/** @type {SlotKey} */ (key)).dayId === dayId && entry.kind === 'session' && entry.areaId === areaId).length);
      assert.ok(Math.max(...perDay) - Math.min(...perDay) <= 1, `${areaId}: ${perDay.join(', ')}`);
    }
  });

  test('puts the projects in the morning slots', () => {
    const slots = generateWeek(areasWith(), {});
    for (const [key, entry] of Object.entries(slots)) {
      if (['09', '10', '11'].includes(parseSlotKey(/** @type {SlotKey} */ (key)).slotId)) {
        assert.ok(entry.kind === 'session' && ['independent', 'group'].includes(entry.areaId), `${key} holds ${JSON.stringify(entry)}`);
      }
    }
  });

  test('generates only fixed and review entries when there are no free slots', () => {
    /** @type {Partial<Record<SlotKey, FixedEntry>>} */
    const fixed = {};
    for (const key of SLOT_KEYS) fixed[key] = fixedEntry('Exams', null);
    const slots = generateWeek(areasWith(), fixed);
    assert.equal(Object.values(slots).filter((entry) => entry.kind === 'session').length, 0);
    assert.equal(Object.values(slots).filter((entry) => entry.kind === 'fixed').length, 34);
    assert.deepEqual(slots['fri-16'], { kind: 'review' });
  });

  test('starts every generated session without a task', () => {
    const sessions = Object.values(generateWeek(areasWith(), {})).filter((entry) => entry.kind === 'session');
    assert.ok(sessions.every((entry) => entry.taskId === null));
  });
});

describe('fixedEntriesFrom', () => {
  test('places recurring events in their slots', () => {
    assert.deepEqual(
      fixedEntriesFrom([{ dayId: 'tue', slotId: '13', label: 'Group meeting', areaId: 'group' }]),
      { 'tue-13': fixedEntry('Group meeting', 'group') },
    );
  });
});
