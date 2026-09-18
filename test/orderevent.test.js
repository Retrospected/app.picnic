'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { deriveOrderEvent, windowTriggersStillApply, deriveOrderFacts } = require('../lib/orderevent.js');

const SLOT = {
  window_start: "2026-07-28T16:00:00.000+02:00",
  window_end: "2026-07-28T17:00:00.000+02:00"
};

const NOW = "2026-07-28T16:21:00.000+02:00";

function summary(extra) {
  return [Object.assign({
    orders: [{ total_price: 4250 }, { total_price: 1000 }],
    slot: SLOT
  }, extra)];
}

test('an open order without an eta means the groceries have been ordered', () => {
  const event = deriveOrderEvent(summary(), null);

  assert.deepStrictEqual(event, {
    event: "groceries_ordered",
    price: 52.5,
    eta1_start: SLOT.window_start,
    eta1_end: SLOT.window_end
  });
});

test('the same open order does not fire a second time', () => {
  assert.strictEqual(deriveOrderEvent(summary(), "groceries_ordered"), null);
});

test('an eta on an ordered delivery announces the delivery', () => {
  const eta2 = { start: "2026-07-28T16:11:00.000+02:00", end: "2026-07-28T16:31:00.000+02:00" };
  const event = deriveOrderEvent(summary({ eta2 }), "groceries_ordered");

  assert.deepStrictEqual(event, {
    event: "delivery_announced",
    eta2_start: eta2.start,
    eta2_end: eta2.end
  });
});

test('an unchanged eta on an announced delivery changes nothing', () => {
  const eta2 = { start: "2026-07-28T16:11:00.000+02:00", end: "2026-07-28T16:31:00.000+02:00" };
  const event = deriveOrderEvent(summary({ eta2 }), "delivery_announced", { start: eta2.start, end: eta2.end });

  assert.strictEqual(event, null);
});

test('a moved eta on an announced delivery reports an update instead of a new announcement', () => {
  const eta2 = { start: "2026-07-28T16:25:00.000+02:00", end: "2026-07-28T16:45:00.000+02:00" };
  const event = deriveOrderEvent(summary({ eta2 }), "delivery_announced", {
    start: "2026-07-28T16:11:00.000+02:00",
    end: "2026-07-28T16:31:00.000+02:00"
  });

  assert.deepStrictEqual(event, {
    event: "delivery_eta_updated",
    eta2_start: eta2.start,
    eta2_end: eta2.end
  });
});

test('an announced delivery without a stored window counts as an update', () => {
  const eta2 = { start: "2026-07-28T16:11:00.000+02:00", end: "2026-07-28T16:31:00.000+02:00" };
  const event = deriveOrderEvent(summary({ eta2 }), "delivery_announced", undefined);

  assert.strictEqual(event.event, "delivery_eta_updated");
});

test('a delivery time means the groceries have been delivered', () => {
  const delivery_time = { start: "2026-07-28T16:18:00.000+02:00", end: "2026-07-28T16:23:00.000+02:00" };
  const event = deriveOrderEvent(summary({ delivery_time }), "delivery_announced");

  assert.deepStrictEqual(event, {
    event: "groceries_delivered",
    delivery_time: delivery_time.start
  });
});

test('a delivery time as a plain timestamp is accepted too', () => {
  const event = deriveOrderEvent(summary({ delivery_time: "2026-07-28T16:18:00.000+02:00" }), "delivery_announced");

  assert.strictEqual(event.delivery_time, "2026-07-28T16:18:00.000+02:00");
});

test('a delivered order does not fire the delivered event again', () => {
  const delivery_time = { start: "2026-07-28T16:18:00.000+02:00", end: "2026-07-28T16:23:00.000+02:00" };

  assert.strictEqual(deriveOrderEvent(summary({ delivery_time }), "groceries_delivered"), null);
});

test('an empty response after a delivery changes nothing', () => {
  assert.strictEqual(deriveOrderEvent([], "groceries_delivered"), null);
});

// The summary is asked for CURRENT deliveries, so a completed one usually
// disappears from the response instead of showing up with a delivery_time.
// Without a fallback the delivered trigger would hand out an empty token on
// what is the most common way for a delivery to end.
test('an empty response while an order was tracked means it has been delivered just now', () => {
  assert.deepStrictEqual(deriveOrderEvent([], "delivery_announced", null, NOW), {
    event: "groceries_delivered",
    delivery_time: NOW
  });
});

test('a delivery time Picnic does not spell out falls back to the moment of the poll', () => {
  const event = deriveOrderEvent(summary({ delivery_time: { end: "2026-07-28T16:23:00.000+02:00" } }), "delivery_announced", null, NOW);

  assert.strictEqual(event.delivery_time, NOW);
});

test('the moment of the poll defaults to the current time', () => {
  const before = Date.now();
  const event = deriveOrderEvent([], "delivery_announced");
  const delivered = new Date(event.delivery_time).getTime();

  assert.ok(delivered >= before && delivered <= Date.now(), "expected " + event.delivery_time + " to be about now");
});

test('an empty response for an app that was following nothing is nothing', () => {
  // a fresh install, or a sign-in between deliveries: Picnic saying there is
  // no current delivery is not a delivery
  assert.strictEqual(deriveOrderEvent([], null, null, NOW), null);
  assert.strictEqual(deriveOrderEvent([], "", null, NOW), null);
  assert.strictEqual(deriveOrderEvent([], "groceries_delivered", null, NOW), null);
});

test('an empty response after an order was being followed is that order delivered', () => {
  assert.deepStrictEqual(deriveOrderEvent([], "groceries_ordered", null, NOW), {
    event: "groceries_delivered",
    delivery_time: NOW
  });
  assert.deepStrictEqual(deriveOrderEvent([], "delivery_announced", null, NOW), {
    event: "groceries_delivered",
    delivery_time: NOW
  });
});

test('a delivery Picnic stamps as delivered counts whether or not it was followed', () => {
  const delivered = summary({ delivery_time: { start: "2026-07-28T16:27:17.942+02:00" } });

  assert.deepStrictEqual(deriveOrderEvent(delivered, null, null, NOW), {
    event: "groceries_delivered",
    delivery_time: "2026-07-28T16:27:17.942+02:00"
  });
});

test('a delivery without a moment on it is only delivered for an order that was followed', () => {
  const unstamped = summary({ delivery_time: {} });

  assert.strictEqual(deriveOrderEvent(unstamped, null, null, NOW), null);
  assert.deepStrictEqual(deriveOrderEvent(unstamped, "delivery_announced", null, NOW), {
    event: "groceries_delivered",
    delivery_time: NOW
  });
});

test('a response that is not a list is ignored', () => {
  assert.strictEqual(deriveOrderEvent({ error: "nope" }, "groceries_ordered"), null);
});

test('a delivery inside the announced window keeps the window triggers', () => {
  assert.strictEqual(windowTriggersStillApply(SLOT.window_start, "2026-07-28T16:18:00.000+02:00"), true);
});

test('a delivery after the announced window keeps the window triggers', () => {
  assert.strictEqual(windowTriggersStillApply(SLOT.window_start, "2026-07-28T18:00:00.000+02:00"), true);
});

test('a delivery before the announced window drops the window triggers', () => {
  assert.strictEqual(windowTriggersStillApply(SLOT.window_start, "2026-07-28T15:12:00.000+02:00"), false);
});

test('an unknown window has no triggers worth keeping', () => {
  assert.strictEqual(windowTriggersStillApply(undefined, "2026-07-28T16:18:00.000+02:00"), false);
  assert.strictEqual(windowTriggersStillApply(null, "2026-07-28T16:18:00.000+02:00"), false);
  assert.strictEqual(windowTriggersStillApply("", "2026-07-28T16:18:00.000+02:00"), false);
  assert.strictEqual(windowTriggersStillApply("not a timestamp", "2026-07-28T16:18:00.000+02:00"), false);
});

test('an unreadable delivery moment leaves the window triggers alone', () => {
  assert.strictEqual(windowTriggersStillApply(SLOT.window_start, "not a timestamp"), true);
});

test('a delivery moment defaults to now, so a passed window keeps its triggers', () => {
  assert.strictEqual(windowTriggersStillApply(SLOT.window_start), true);
  assert.strictEqual(windowTriggersStillApply(new Date(Date.now() + 60000).toISOString()), false);
});

test('the cut off of the slot is read off every poll, not off an event', () => {
  const facts = deriveOrderFacts(summary({ slot: Object.assign({ cut_off_time: "2026-07-28T14:00:00.000+02:00" }, SLOT) }));

  assert.strictEqual(facts.cutOffTime, "2026-07-28T14:00:00.000+02:00");
});

test('a slot without a cut off, or no slot, or no delivery, reports nothing rather than guessing', () => {
  assert.strictEqual(deriveOrderFacts(summary()).cutOffTime, null);
  assert.strictEqual(deriveOrderFacts([{}]).cutOffTime, null);
  assert.strictEqual(deriveOrderFacts([]).cutOffTime, null);
  assert.strictEqual(deriveOrderFacts(null).cutOffTime, null);
});

test('a cut off that is not a timestamp is not passed on as one', () => {
  assert.strictEqual(deriveOrderFacts([{ slot: { cut_off_time: 1769000000 } }]).cutOffTime, null);
  assert.strictEqual(deriveOrderFacts([{ slot: { cut_off_time: "" } }]).cutOffTime, null);
});

test('the delivery being followed is remembered by its id', () => {
  assert.strictEqual(deriveOrderFacts(summary({ delivery_id: "d123" })).deliveryId, "d123");
  assert.strictEqual(deriveOrderFacts([{ delivery_id: "d123" }]).deliveryId, "d123");
  assert.strictEqual(deriveOrderFacts(summary()).deliveryId, null);
  assert.strictEqual(deriveOrderFacts([]).deliveryId, null);
});

test('an order placed after the last delivery is a new order, not more of the old one', () => {
  const placed = [{
    delivery_id: "d2",
    status: "CURRENT",
    slot: { window_start: "2026-09-19T08:30:00.000+02:00", window_end: "2026-09-19T09:30:00.000+02:00", cut_off_time: "2026-09-18T13:00:00.000+02:00" },
    orders: [{ total_price: 4512 }]
  }];

  assert.deepStrictEqual(deriveOrderEvent(placed, "groceries_delivered", null, NOW), {
    event: "groceries_ordered",
    price: 45.12,
    eta1_start: "2026-09-19T08:30:00.000+02:00",
    eta1_end: "2026-09-19T09:30:00.000+02:00"
  });
  assert.strictEqual(deriveOrderFacts(placed).cutOffTime, "2026-09-18T13:00:00.000+02:00");
  assert.strictEqual(deriveOrderFacts(placed).deliveryId, "d2");
});
