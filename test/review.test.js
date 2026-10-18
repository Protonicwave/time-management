import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { finishedInWeek, summariseInterruptions, summariseWeek } from '../src/domain/review.js';

/** @import { Area, AreaId, LocalDate, Outcome, SessionLog, SlotKey, Task, Week } from '../src/domain/types.js' */

/** @type {Area[]} */
const areas = [
  { id: 'independent', name: 'Independent project', target: 13 },
  { id: 'group', name: 'Group project', target: 8 },
  { id: 'buffer', name: 'Buffer', target: 2 },
];

let nextLogId = 0;

/**
 * @param {{ date?: LocalDate, slotKey?: SlotKey | null, areaId?: AreaId, minutes?: number, outcome?: Outcome }} fields
 * @returns {SessionLog}
 */
function log({ date = '2026-10-19', slotKey = 'mon-09', areaId = 'independent', minutes = 50, outcome = 'completed' }) {
  return {
    id: `log-${(nextLogId += 1)}`, date, slotKey, areaId, taskId: null,
    startedAt: `${date}T08:00:00.000Z`, minutes, outcome, note: '',
  };
}

/** @returns {Week} */
function weekWithFixedGroupMeeting() {
  /** @type {Partial<Week['slots']>} */
  const slots = {
    'mon-09': { kind: 'session', areaId: 'independent', taskId: null },
    'mon-10': { kind: 'session', areaId: 'independent', taskId: null },
    'tue-13': { kind: 'fixed', label: 'Group meeting', areaId: 'group' },
    'tue-14': { kind: 'fixed', label: 'Careers fair', areaId: null },
    'wed-09': { kind: 'session', areaId: 'group', taskId: null },
    'fri-16': { kind: 'review' },
  };
  return { slots: /** @type {Week['slots']} */ (slots) };
}

describe('summariseWeek', () => {
  test('counts planned sessions per area, including fixed events linked to it', () => {
    const summary = summariseWeek(areas, weekWithFixedGroupMeeting(), [], '2026-10-19', 50);
    assert.deepEqual(summary.rows.map((row) => [row.areaId, row.planned]), [['independent', 2], ['group', 2], ['buffer', 0]]);
    assert.equal(summary.planned, 4);
  });

  test('counts logged minutes as sessions of the focus length, in this week only', () => {
    const logs = [
      log({ minutes: 50 }),
      log({ date: '2026-10-21', minutes: 25, outcome: 'interrupted' }),
      log({ date: '2026-10-22', slotKey: null, areaId: 'group', minutes: 50 }),
      log({ date: '2026-10-25', slotKey: null, minutes: 50 }),
      log({ date: '2026-10-16', slotKey: 'fri-09', minutes: 50 }),
    ];
    const summary = summariseWeek(areas, weekWithFixedGroupMeeting(), logs, '2026-10-19', 50);
    assert.deepEqual(summary.rows.map((row) => [row.areaId, row.logged]), [['independent', 2.5], ['group', 1], ['buffer', 0]]);
    assert.equal(summary.logged, 3.5);
    assert.equal(summary.focusMinutes, 175);
  });

  test('reports nothing planned for a week never opened', () => {
    const summary = summariseWeek(areas, undefined, [], '2026-10-26', 50);
    assert.equal(summary.planned, 0);
    assert.equal(summary.logged, 0);
  });
});

describe('summariseInterruptions', () => {
  test('counts sessions stopped early and their minutes', () => {
    const logs = [
      log({ outcome: 'interrupted', minutes: 20 }),
      log({ slotKey: null, outcome: 'interrupted', minutes: 12 }),
      log({ outcome: 'completed' }),
      log({ date: '2026-10-12', slotKey: 'mon-09', outcome: 'interrupted', minutes: 40 }),
    ];
    const result = summariseInterruptions(logs, '2026-10-19');
    assert.equal(result.count, 2);
    assert.equal(result.minutes, 32);
  });

  test('names the day with most interruptions and the slots involved', () => {
    const logs = [
      log({ date: '2026-10-19', slotKey: 'mon-09', outcome: 'interrupted', minutes: 10 }),
      log({ date: '2026-10-21', slotKey: 'wed-15', outcome: 'interrupted', minutes: 10 }),
      log({ date: '2026-10-21', slotKey: 'wed-14', outcome: 'interrupted', minutes: 10 }),
    ];
    assert.deepEqual(summariseInterruptions(logs, '2026-10-19').busiest, { dayId: 'wed', slotIds: ['14', '15'] });
  });

  test('breaks a tie for busiest day by the earlier day', () => {
    const logs = [
      log({ date: '2026-10-22', slotKey: 'thu-09', outcome: 'interrupted', minutes: 10 }),
      log({ date: '2026-10-20', slotKey: 'tue-11', outcome: 'interrupted', minutes: 10 }),
    ];
    assert.equal(summariseInterruptions(logs, '2026-10-19').busiest?.dayId, 'tue');
  });

  test('has no busiest day without interruptions in a slot', () => {
    const logs = [log({ slotKey: null, outcome: 'interrupted', minutes: 10 })];
    assert.equal(summariseInterruptions(logs, '2026-10-19').busiest, null);
    assert.deepEqual(summariseInterruptions([], '2026-10-19'), { count: 0, minutes: 0, busiest: null });
  });
});

describe('finishedInWeek', () => {
  test('lists tasks finished this week with the sessions they took', () => {
    /** @type {Task[]} */
    const tasks = [
      { id: 'a', areaId: 'independent', title: 'Benchmark decoder', estimate: 3, finishedOn: '2026-10-21' },
      { id: 'b', areaId: 'group', title: 'Open task', estimate: 2, finishedOn: null },
      { id: 'c', areaId: 'group', title: 'Last week', estimate: 2, finishedOn: '2026-10-16' },
      { id: 'd', areaId: 'group', title: 'Nothing logged', estimate: 1, finishedOn: '2026-10-25' },
    ];
    const result = finishedInWeek(tasks, new Map([['a', 4.2], ['c', 2]]), '2026-10-19');
    assert.deepEqual(result.map((item) => [item.task.id, item.logged]), [['a', 4.2], ['d', 0]]);
  });
});
