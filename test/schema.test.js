import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWeek } from '../src/domain/allocation.js';
import { NewerSchemaError, SchemaError, defaultState, parseState, validateSettings } from '../src/domain/schema.js';

/** @import { AppState } from '../src/domain/types.js' */

/** @returns {AppState} */
function fullState() {
  const state = defaultState();
  return {
    ...state,
    settings: { ...state.settings, recurring: [{ dayId: 'tue', slotId: '13', label: 'Group meeting', areaId: 'group' }] },
    weeks: { '2026-10-19': { slots: generateWeek(state.settings.areas, {}) } },
    tasks: [{ id: 't1', areaId: 'independent', title: 'Draft results section', estimate: 4, finishedOn: null }],
    logs: [{
      id: 'l1', date: '2026-10-19', slotKey: 'mon-09', areaId: 'independent', taskId: 't1',
      startedAt: '2026-10-19T08:00:00.000Z', minutes: 50, outcome: 'completed', note: 'Good start',
    }],
    deadlines: [{ id: 'd1', title: 'Coursework 1', date: '2026-11-06', areaId: 'module-1' }],
    timer: {
      phase: 'focus', startedAt: '2026-10-19T09:00:00.000Z',
      context: { date: '2026-10-19', slotKey: 'mon-10', areaId: 'independent', taskId: 't1', focusMinutes: 50, breakMinutes: 10 },
    },
    lastExportOn: '2026-10-16',
  };
}

/**
 * Round trip through JSON so each test mutates its own plain copy, as
 * stored data would be.
 * @returns {any}
 */
function rawState() {
  return JSON.parse(JSON.stringify(fullState()));
}

describe('defaults', () => {
  test('are valid and allocate all 34 sessions', () => {
    const state = defaultState();
    assert.deepEqual(parseState(state), state);
    assert.equal(state.settings.areas.reduce((sum, area) => sum + area.target, 0), 34);
    assert.deepEqual([state.settings.focusMinutes, state.settings.breakMinutes], [50, 10]);
  });
});

describe('parseState', () => {
  test('accepts a fully populated state unchanged', () => {
    assert.deepEqual(parseState(rawState()), fullState());
  });

  test('drops unknown fields', () => {
    const raw = rawState();
    raw.extra = true;
    raw.tasks[0].colour = 'red';
    const parsed = /** @type {any} */ (parseState(raw));
    assert.equal(parsed.extra, undefined);
    assert.equal(parsed.tasks[0].colour, undefined);
  });

  test('trims names and titles', () => {
    const raw = rawState();
    raw.tasks[0].title = '  Draft results  ';
    assert.equal(parseState(raw).tasks[0]?.title, 'Draft results');
  });

  /** @type {[string, (raw: any) => void, string][]} */
  const cases = [
    ['not an object', (raw) => { raw.settings = []; }, 'settings: expected an object, got []'],
    ['focus too long', (raw) => { raw.settings.focusMinutes = 121; }, 'settings.focusMinutes: expected integer from 1 to 120, got 121'],
    ['fractional break', (raw) => { raw.settings.breakMinutes = 2.5; }, 'settings.breakMinutes: expected integer from 0 to 60, got 2.5'],
    ['unknown theme', (raw) => { raw.settings.theme = 'sepia'; }, 'settings.theme: expected one of system, light, dark, got "sepia"'],
    ['area missing', (raw) => { raw.settings.areas.pop(); }, 'settings.areas: expected an area with id "buffer", got nothing'],
    ['area repeated', (raw) => { raw.settings.areas[6].id = 'group'; }, 'settings.areas[6].id: expected an id not used earlier in the list, got "group"'],
    ['unknown area', (raw) => { raw.settings.areas[0].id = 'thesis'; }, 'settings.areas[0].id: expected one of independent, group, careers, module-1, module-2, module-3, buffer, got "thesis"'],
    ['blank area name', (raw) => { raw.settings.areas[3].name = '   '; }, 'settings.areas[3].name: expected non-empty text, got "   "'],
    ['negative target', (raw) => { raw.settings.areas[0].target = -1; }, 'settings.areas[0].target: expected integer from 0 to 35, got -1'],
    ['recurring at lunch', (raw) => { raw.settings.recurring[0].slotId = '12'; }, 'settings.recurring[0].slotId: expected one of 09, 10, 11, 13, 14, 15, 16, got "12"'],
    ['recurring on review', (raw) => { raw.settings.recurring[0].dayId = 'fri'; raw.settings.recurring[0].slotId = '16'; }, 'settings.recurring[0]: expected a slot other than the weekly review, got "fri-16"'],
    ['recurring twice', (raw) => { raw.settings.recurring.push({ ...raw.settings.recurring[0] }); }, 'settings.recurring[1]: expected one fixed event per slot, got "tue-13"'],
    ['week not on Monday', (raw) => { raw.weeks['2026-10-20'] = raw.weeks['2026-10-19']; }, 'weeks["2026-10-20"]: expected a key that is a Monday as YYYY-MM-DD, got "2026-10-20"'],
    ['slot missing', (raw) => { delete raw.weeks['2026-10-19'].slots['wed-14']; }, 'weeks["2026-10-19"].slots.wed-14: expected an object, got nothing'],
    ['stray slot', (raw) => { raw.weeks['2026-10-19'].slots['mon-12'] = { kind: 'review' }; }, 'weeks["2026-10-19"].slots.mon-12: expected a library slot such as mon-09, got "mon-12"'],
    ['review moved', (raw) => { raw.weeks['2026-10-19'].slots['fri-16'] = { kind: 'session', areaId: 'buffer', taskId: null }; }, 'weeks["2026-10-19"].slots.fri-16: expected the weekly review, got "session"'],
    ['second review', (raw) => { raw.weeks['2026-10-19'].slots['mon-09'] = { kind: 'review' }; }, 'weeks["2026-10-19"].slots.mon-09: expected a session or fixed event, got "review"'],
    ['unknown slot kind', (raw) => { raw.weeks['2026-10-19'].slots['mon-09'].kind = 'nap'; }, 'weeks["2026-10-19"].slots.mon-09.kind: expected one of session, fixed, review, got "nap"'],
    ['zero estimate', (raw) => { raw.tasks[0].estimate = 0; }, 'tasks[0].estimate: expected integer from 1 to 100, got 0'],
    ['bad finish date', (raw) => { raw.tasks[0].finishedOn = '2026-02-30'; }, 'tasks[0].finishedOn: expected a date as YYYY-MM-DD, got "2026-02-30"'],
    ['duplicate task id', (raw) => { raw.tasks.push({ ...raw.tasks[0] }); }, 'tasks[1].id: expected an id not used earlier in the list, got "t1"'],
    ['empty task id', (raw) => { raw.tasks[0].id = ''; }, 'tasks[0].id: expected non-empty text, got ""'],
    ['zero log minutes', (raw) => { raw.logs[0].minutes = 0; }, 'logs[0].minutes: expected integer from 1 to 120, got 0'],
    ['local start time', (raw) => { raw.logs[0].startedAt = '2026-10-19 09:00'; }, 'logs[0].startedAt: expected an ISO 8601 instant in UTC, got "2026-10-19 09:00"'],
    ['unknown outcome', (raw) => { raw.logs[0].outcome = 'abandoned'; }, 'logs[0].outcome: expected one of completed, interrupted, got "abandoned"'],
    ['missing note', (raw) => { delete raw.logs[0].note; }, 'logs[0].note: expected text of at most 2000 characters, got nothing'],
    ['deadline area', (raw) => { raw.deadlines[0].areaId = null; }, 'deadlines[0].areaId: expected one of independent, group, careers, module-1, module-2, module-3, buffer, got null'],
    ['timer phase', (raw) => { raw.timer.phase = 'paused'; }, 'timer.phase: expected one of idle, focus, break, got "paused"'],
    ['timer context', (raw) => { raw.timer.context.focusMinutes = 0; }, 'timer.context.focusMinutes: expected integer from 1 to 120, got 0'],
    ['export date', (raw) => { raw.lastExportOn = 20261016; }, 'lastExportOn: expected a date as YYYY-MM-DD, got 20261016'],
  ];

  for (const [name, corrupt, message] of cases) {
    test(`rejects ${name} with the path and expected value`, () => {
      const raw = rawState();
      corrupt(raw);
      assert.throws(() => parseState(raw), { name: 'SchemaError', message });
    });
  }

  test('shortens long offending values in the message', () => {
    const raw = rawState();
    raw.tasks[0].title = 'x'.repeat(3000);
    assert.throws(() => parseState(raw), (error) => error instanceof SchemaError && error.message.length < 140);
  });
});

describe('migration', () => {
  test('reads version 1 as it is', () => {
    assert.deepEqual(parseState(rawState()), fullState());
  });

  test('rejects data without a version', () => {
    const raw = rawState();
    delete raw.schemaVersion;
    assert.throws(() => parseState(raw), { message: 'schemaVersion: expected integer >= 1, got nothing' });
    assert.throws(() => parseState('{}'), { message: 'state: expected an object, got "{}"' });
  });

  test('rejects a newer version, naming the version found and supported', () => {
    const raw = rawState();
    raw.schemaVersion = 2;
    assert.throws(() => parseState(raw), (error) =>
      error instanceof NewerSchemaError
      && error.message === 'saved data is schema version 2; this version of Logbook reads up to 1');
  });
});

describe('validateSettings', () => {
  test('validates settings alone, under the given path', () => {
    const settings = { ...defaultState().settings, focusMinutes: 0 };
    assert.throws(() => validateSettings(settings), { message: 'settings.focusMinutes: expected integer from 1 to 120, got 0' });
  });
});
