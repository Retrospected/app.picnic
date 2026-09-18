'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { deriveCutOff } = require('../lib/cutoff.js');

const AMSTERDAM = 'Europe/Amsterdam';

// what a clock in Homey's timezone reads at the deadline, which is the way the
// rule is stated and the way the widget shows it
function local(iso) {
  if (iso === null) return null;

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: AMSTERDAM,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new Date(iso)).replace(',', '');
}

test('a delivery in the afternoon closes at 23:00 the day before', () => {
  assert.strictEqual(local(deriveCutOff("2026-07-28T16:00:00.000+02:00", AMSTERDAM)), "27/07/2026 23:00");
});

test('a delivery in the morning closes at 13:00 the day before', () => {
  assert.strictEqual(local(deriveCutOff("2026-07-28T08:00:00.000+02:00", AMSTERDAM)), "27/07/2026 13:00");
});

test('a delivery starting at 13:00 is an afternoon one', () => {
  assert.strictEqual(local(deriveCutOff("2026-07-28T13:00:00.000+02:00", AMSTERDAM)), "27/07/2026 23:00");
});

test('a delivery just before 13:00 is a morning one', () => {
  assert.strictEqual(local(deriveCutOff("2026-07-28T12:59:00.000+02:00", AMSTERDAM)), "27/07/2026 13:00");
});

test('the day before the first of a month is in the month before it', () => {
  assert.strictEqual(local(deriveCutOff("2026-08-01T08:00:00.000+02:00", AMSTERDAM)), "31/07/2026 13:00");
});

test('the day before new year is in the year before it', () => {
  assert.strictEqual(local(deriveCutOff("2027-01-01T09:00:00.000+01:00", AMSTERDAM)), "31/12/2026 13:00");
});

test('the deadline is a time on a clock, so the night the clock goes back keeps it at 23:00', () => {
  // the delivery is on the Sunday the clocks go back, the deadline the evening before
  assert.strictEqual(local(deriveCutOff("2026-10-25T16:00:00.000+01:00", AMSTERDAM)), "24/10/2026 23:00");
});

test('and the night it goes forward keeps it at 13:00', () => {
  // the delivery is on the Sunday the clocks go forward, an hour that never
  // existed lies between the deadline and it
  assert.strictEqual(local(deriveCutOff("2026-03-29T08:00:00.000+02:00", AMSTERDAM)), "28/03/2026 13:00");
});

test('the moment is absolute, not a local time pretending to be one', () => {
  assert.strictEqual(deriveCutOff("2026-07-28T16:00:00.000+02:00", AMSTERDAM), "2026-07-27T21:00:00.000Z");
});

test('the timezone is what decides it, not the offset the window came in', () => {
  // the same moment, written the way a UTC API would write it
  assert.strictEqual(
    deriveCutOff("2026-07-28T14:00:00.000Z", AMSTERDAM),
    deriveCutOff("2026-07-28T16:00:00.000+02:00", AMSTERDAM)
  );
});

test('a window that says nothing produces no deadline rather than one in 1970', () => {
  assert.strictEqual(deriveCutOff(null, AMSTERDAM), null);
  assert.strictEqual(deriveCutOff("", AMSTERDAM), null);
  assert.strictEqual(deriveCutOff("whenever", AMSTERDAM), null);
  assert.strictEqual(deriveCutOff(1769000000, AMSTERDAM), null);
});

test('a timezone Homey cannot name falls back on the one the app runs in', () => {
  // undefined means the system timezone to Intl, which is what the rest of the
  // app does with an unset timezone as well
  assert.notStrictEqual(deriveCutOff("2026-07-28T16:00:00.000+02:00", ""), null);
});
