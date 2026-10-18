import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { IDLE, advance, startFocus, stop } from '../src/domain/timer.js';

/** @import { SessionContext, TimerState } from '../src/domain/types.js' */

/** @type {SessionContext} */
const context = { date: '2026-10-20', slotKey: 'tue-10', areaId: 'independent', taskId: 't1', focusMinutes: 50, breakMinutes: 10 };
const start = new Date('2026-10-20T09:00:00.000Z');

/** @param {number} minutes */
const at = (minutes) => new Date(start.getTime() + minutes * 60_000);

describe('timer', () => {
  test('runs focus, then break, then returns to idle', () => {
    const focus = startFocus(IDLE, context, start);
    assert.deepEqual(focus, { phase: 'focus', startedAt: '2026-10-20T09:00:00.000Z', context });

    assert.deepEqual(advance(focus, at(49.9)), { timer: focus, finished: null });

    const ended = advance(focus, at(50));
    assert.deepEqual(ended.finished, { context, startedAt: '2026-10-20T09:00:00.000Z', minutes: 50, outcome: 'completed' });
    assert.deepEqual(ended.timer, { phase: 'break', startedAt: '2026-10-20T09:50:00.000Z', breakMinutes: 10 });

    assert.deepEqual(advance(ended.timer, at(59)), { timer: ended.timer, finished: null });
    assert.deepEqual(advance(ended.timer, at(60)), { timer: IDLE, finished: null });
  });

  test('logs one completed session when asleep across the end of focus', () => {
    const { timer, finished } = advance(startFocus(IDLE, context, start), at(55));
    assert.equal(finished?.minutes, 50);
    assert.equal(finished?.startedAt, '2026-10-20T09:00:00.000Z');
    assert.equal(timer.phase, 'break');
  });

  test('skips an expired break when asleep across both ends', () => {
    const { timer, finished } = advance(startFocus(IDLE, context, start), at(300));
    assert.equal(finished?.outcome, 'completed');
    assert.equal(finished?.minutes, 50);
    assert.deepEqual(timer, IDLE);
  });

  test('goes straight to idle when the break length is zero', () => {
    const { timer } = advance(startFocus(IDLE, { ...context, breakMinutes: 0 }, start), at(50));
    assert.deepEqual(timer, IDLE);
  });

  test('logs a stop after one minute or more as interrupted, in whole minutes', () => {
    const { timer, finished } = stop(startFocus(IDLE, context, start), at(31.8));
    assert.deepEqual(timer, IDLE);
    assert.deepEqual(finished, { context, startedAt: '2026-10-20T09:00:00.000Z', minutes: 31, outcome: 'interrupted' });
  });

  test('discards a stop under one minute as a false start', () => {
    assert.deepEqual(stop(startFocus(IDLE, context, start), at(0.9)), { timer: IDLE, finished: null });
  });

  test('logs a stop after focus has ended as completed', () => {
    const { timer, finished } = stop(startFocus(IDLE, context, start), at(52));
    assert.deepEqual(timer, IDLE);
    assert.equal(finished?.outcome, 'completed');
    assert.equal(finished?.minutes, 50);
  });

  test('ends a break when stopped, logging nothing', () => {
    /** @type {TimerState} */
    const onBreak = { phase: 'break', startedAt: start.toISOString(), breakMinutes: 10 };
    assert.deepEqual(stop(onBreak, at(2)), { timer: IDLE, finished: null });
  });

  test('keeps the lengths captured at start', () => {
    const focus = startFocus(IDLE, { ...context, focusMinutes: 25, breakMinutes: 5 }, start);
    assert.equal(advance(focus, at(25)).finished?.minutes, 25);
    assert.deepEqual(advance(focus, at(30)).timer, IDLE);
  });

  test('starting during a break ends the break', () => {
    /** @type {TimerState} */
    const onBreak = { phase: 'break', startedAt: start.toISOString(), breakMinutes: 10 };
    assert.equal(startFocus(onBreak, context, at(3)).phase, 'focus');
  });

  test('refuses to start while focus is running', () => {
    const focus = startFocus(IDLE, context, start);
    assert.throws(() => startFocus(focus, context, at(5)), {
      name: 'TimerStateError',
      message: 'cannot start a session while the timer is in phase "focus"',
    });
  });

  test('treats a clock set backwards as no time elapsed', () => {
    const focus = startFocus(IDLE, context, start);
    assert.deepEqual(advance(focus, at(-30)), { timer: focus, finished: null });
    assert.deepEqual(stop(focus, at(-30)), { timer: IDLE, finished: null });
  });
});
