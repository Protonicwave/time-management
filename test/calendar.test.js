import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InvalidDateError,
  REVIEW_SLOT_KEY,
  SLOT_KEYS,
  addDays,
  dateOfDay,
  dayIdOf,
  isLocalDate,
  isSlotKey,
  localDateOf,
  mondayOf,
  nextLibraryDay,
  parseLocalDate,
  parseSlotKey,
  slotKey,
} from '../src/domain/calendar.js';

describe('dates', () => {
  test('accepts real calendar dates', () => {
    assert.equal(parseLocalDate('2026-10-19'), '2026-10-19');
    assert.equal(parseLocalDate('2028-02-29'), '2028-02-29');
  });

  test('rejects impossible and malformed dates, naming the offending text', () => {
    for (const bad of ['2026-02-29', '2026-13-01', '2026-04-31', '2026-1-5', '19/10/2026', '', 20261019, null]) {
      assert.equal(isLocalDate(bad), false, String(bad));
    }
    assert.throws(() => parseLocalDate('2026-02-30'), {
      name: 'InvalidDateError',
      message: 'expected a calendar date as YYYY-MM-DD, got "2026-02-30"',
    });
    assert.throws(() => parseLocalDate(undefined), InvalidDateError);
  });

  test('adds days across month and year ends', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });

  test('adds whole calendar days across daylight-saving changes', () => {
    // UK clocks go forward on 29 March 2026 and back on 25 October 2026.
    assert.equal(addDays('2026-03-28', 1), '2026-03-29');
    assert.equal(addDays('2026-03-29', 1), '2026-03-30');
    assert.equal(addDays('2026-10-24', 2), '2026-10-26');
    assert.equal(mondayOf('2026-03-29'), '2026-03-23');
    assert.equal(mondayOf('2026-10-26'), '2026-10-26');
  });

  test('reads the local date of an instant at either end of the day', () => {
    assert.equal(localDateOf(new Date(2026, 2, 29, 0, 30)), '2026-03-29');
    assert.equal(localDateOf(new Date(2026, 9, 25, 23, 59)), '2026-10-25');
  });
});

describe('weeks', () => {
  test('finds the Monday of any day in the week', () => {
    for (const date of ['2026-10-19', '2026-10-21', '2026-10-23', '2026-10-24', '2026-10-25']) {
      assert.equal(mondayOf(date), '2026-10-19', date);
    }
  });

  test('names library days and returns null at the weekend', () => {
    assert.equal(dayIdOf('2026-10-19'), 'mon');
    assert.equal(dayIdOf('2026-10-23'), 'fri');
    assert.equal(dayIdOf('2026-10-24'), null);
    assert.equal(dayIdOf('2026-10-25'), null);
  });

  test('dates each day of a week from its Monday', () => {
    assert.equal(dateOfDay('2026-10-19', 'mon'), '2026-10-19');
    assert.equal(dateOfDay('2026-10-19', 'fri'), '2026-10-23');
  });

  test('skips the weekend when finding the next library day', () => {
    assert.equal(nextLibraryDay('2026-10-19'), '2026-10-20');
    assert.equal(nextLibraryDay('2026-10-23'), '2026-10-26');
    assert.equal(nextLibraryDay('2026-10-24'), '2026-10-26');
    assert.equal(nextLibraryDay('2026-10-25'), '2026-10-26');
  });
});

describe('slots', () => {
  test('has seven slots on each of five days, skipping lunch', () => {
    assert.equal(SLOT_KEYS.length, 35);
    assert.equal(new Set(SLOT_KEYS).size, 35);
    assert.deepEqual(SLOT_KEYS.slice(0, 7), ['mon-09', 'mon-10', 'mon-11', 'mon-13', 'mon-14', 'mon-15', 'mon-16']);
    assert.equal(isSlotKey('mon-12'), false);
    assert.equal(isSlotKey('sat-09'), false);
  });

  test('reserves the last Friday slot for the review', () => {
    assert.equal(REVIEW_SLOT_KEY, 'fri-16');
    assert.ok(SLOT_KEYS.includes(REVIEW_SLOT_KEY));
  });

  test('round-trips slot keys', () => {
    assert.equal(slotKey('wed', '14'), 'wed-14');
    assert.deepEqual(parseSlotKey('wed-14'), { dayId: 'wed', slotId: '14' });
  });
});
