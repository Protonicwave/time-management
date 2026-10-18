import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { clock, compactMinutes, countdown, dayMonth, duration, longDate, plural, weekday } from '../src/ui/dom.js';

describe('formatting', () => {
  test('writes times and countdowns with two-digit fields', () => {
    assert.equal(clock(9), '09:00');
    assert.equal(clock(16, 50), '16:50');
    assert.equal(countdown(17 * 60 + 42), '17:42');
    assert.equal(countdown(5), '00:05');
    assert.equal(countdown(120 * 60), '120:00');
  });

  test('writes durations out in text and compactly in columns', () => {
    assert.equal(duration(1475), '24 hours 35 minutes');
    assert.equal(duration(341), '5 hours 41 minutes');
    assert.equal(duration(60), '1 hour');
    assert.equal(duration(1), '1 minute');
    assert.equal(duration(0), '0 minutes');
    assert.equal(compactMinutes(50), '50 min');
  });

  test('pluralises counts', () => {
    assert.equal(plural(1, 'session'), '1 session');
    assert.equal(plural(0, 'session'), '0 sessions');
  });

  test('names calendar dates in UK order', () => {
    assert.equal(longDate('2026-10-20'), 'Tuesday 20 October');
    assert.equal(weekday('2026-10-24'), 'Saturday');
    assert.equal(dayMonth('2026-03-29'), '29 March');
  });
});
