'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { formatEtaTime, formatEtaDate } = require('../lib/eta.js');

const AMSTERDAM = "Europe/Amsterdam";

test('formats a timestamp with a local offset, the shape Picnic sends today', () => {
  assert.strictEqual(formatEtaTime("2026-07-28T16:11:00.000+02:00", AMSTERDAM), "16:11");
  assert.strictEqual(formatEtaDate("2026-07-28T16:11:00.000+02:00", AMSTERDAM), "2026-07-28");
});

test('formats a UTC timestamp in the Homey timezone instead of showing UTC', () => {
  assert.strictEqual(formatEtaTime("2026-07-28T14:11:00.000Z", AMSTERDAM), "16:11");
  assert.strictEqual(formatEtaDate("2026-07-28T14:11:00.000Z", AMSTERDAM), "2026-07-28");
});

test('rolls the date over when the timezone puts the delivery on the next day', () => {
  assert.strictEqual(formatEtaTime("2026-07-28T23:30:00.000Z", AMSTERDAM), "01:30");
  assert.strictEqual(formatEtaDate("2026-07-28T23:30:00.000Z", AMSTERDAM), "2026-07-29");
});

test('keeps midnight at 00:00 rather than 24:00', () => {
  assert.strictEqual(formatEtaTime("2026-07-28T00:00:00.000+02:00", AMSTERDAM), "00:00");
});

test('returns an empty string when there is no timestamp', () => {
  assert.strictEqual(formatEtaTime(null, AMSTERDAM), "");
  assert.strictEqual(formatEtaTime(undefined, AMSTERDAM), "");
  assert.strictEqual(formatEtaDate(null, AMSTERDAM), "");
});

test('falls back to the old string based format on a runtime without timezone data', () => {
  // an unresolvable timezone makes Intl throw, which is what a Homey without
  // full timezone data would do
  assert.strictEqual(formatEtaTime("2026-07-28T16:11:00.000+02:00", "Not/AZone"), "16:11");
  assert.strictEqual(formatEtaDate("2026-07-28T16:11:00.000+02:00", "Not/AZone"), "2026-07-28");
});
