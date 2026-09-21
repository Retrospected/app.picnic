'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { parsePosition } = require('../lib/positionresponse.js');

// the answer the public clients model, from a van on the road
const ON_THE_ROAD = {
  version: 1,
  scenario_ts: 1704795199346,
  eta: 1704797648363,
  eta_window: { start: "2024-01-09T11:43:26.361+01:00", end: "2024-01-09T12:03:26.361+01:00" },
  query_interval: 10000,
  scenario_in_progress: true
};

test('a van on the road is on its way, with its live window', () => {
  const position = parsePosition(JSON.stringify(ON_THE_ROAD));

  assert.strictEqual(position.inProgress, true);
  assert.strictEqual(position.etaStart, "2024-01-09T11:43:26.361+01:00");
  assert.strictEqual(position.etaEnd, "2024-01-09T12:03:26.361+01:00");
  assert.strictEqual(position.eta, "2024-01-09T10:54:08.363Z");
  assert.strictEqual(position.queryInterval, 10000);
});

test('a route not being driven is not on its way, whatever else is known', () => {
  const position = parsePosition(JSON.stringify(Object.assign({}, ON_THE_ROAD, { scenario_in_progress: false })));

  assert.strictEqual(position.inProgress, false);
  assert.strictEqual(position.etaStart, "2024-01-09T11:43:26.361+01:00");
});

test('nothing said about the van yet is nothing, not a failure', () => {
  assert.strictEqual(parsePosition(""), null);
  assert.strictEqual(parsePosition("   "), null);
  assert.strictEqual(parsePosition("{}"), null);
  assert.strictEqual(parsePosition(JSON.stringify({ error: { code: "NOT_FOUND" } })), null);
  assert.strictEqual(parsePosition("<html>"), null);
  assert.strictEqual(parsePosition("[]"), null);
});

test('a window with moments that are not there leaves them out rather than throwing', () => {
  const position = parsePosition(JSON.stringify({ eta_window: { start: 5 }, eta: "soon", query_interval: -1, scenario_in_progress: "yes" }));

  assert.deepStrictEqual(position, { inProgress: false, etaStart: null, etaEnd: null, eta: null, queryInterval: null });
});
