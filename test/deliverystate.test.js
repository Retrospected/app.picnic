'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { deriveDeliveryState, orderCheckDue, ORDER_MAX_AGE } = require('../lib/deliverystate.js');

const WINDOW_START = "2026-07-28T16:00:00.000+02:00";
const WINDOW_END = "2026-07-28T17:00:00.000+02:00";

// Picnic answered the poll that wrote this down a moment ago, unless a test
// says otherwise
function stored(extra) {
  const values = Object.assign({
    orderStatus: "delivery_announced",
    etaStart: WINDOW_START,
    etaEnd: WINDOW_END,
    announcedAt: "2026-07-28T15:00:00.000+02:00",
    now: "2026-07-28T15:30:00.000+02:00"
  }, extra);

  if (!("checkedAt" in values)) values.checkedAt = values.now;
  return values;
}

test('nothing ordered leaves the widget with nothing to show', () => {
  const state = deriveDeliveryState({ orderStatus: "", now: WINDOW_START, checkedAt: WINDOW_START });

  assert.strictEqual(state.state, "empty");
  assert.strictEqual(state.countdownTo, null);
  assert.strictEqual(state.progress, null);
});

test('an app that cannot reach Picnic says so rather than that nothing is planned', () => {
  const state = deriveDeliveryState(stored({ signInNeeded: true }));

  assert.strictEqual(state.state, "signed_out");
});

test('an ordered delivery counts down to the start of its slot', () => {
  const state = deriveDeliveryState(stored({ orderStatus: "groceries_ordered", announcedAt: null }));

  assert.strictEqual(state.state, "ordered");
  assert.strictEqual(state.countdownTo, WINDOW_START);
  assert.strictEqual(state.etaEnd, WINDOW_END);
});

test('an ordered delivery leaves the bar empty, it is the announcement that draws near', () => {
  const state = deriveDeliveryState(stored({ orderStatus: "groceries_ordered" }));

  assert.strictEqual(state.progress, null);
});

test('an announced delivery counts down to its window without a bar: the van has not left', () => {
  const state = deriveDeliveryState(stored());

  assert.strictEqual(state.state, "announced");
  assert.strictEqual(state.countdownTo, WINDOW_START);
  assert.strictEqual(state.progress, null);
});

// the van on the road, as Picnic reports it
const ON_THE_ROAD = { inProgress: true, etaStart: WINDOW_START, etaEnd: WINDOW_END };

test('a van on the road is on its way, and fills the bar from the moment it left', () => {
  const state = deriveDeliveryState(stored({ position: ON_THE_ROAD, underwayAt: "2026-07-28T15:00:00.000+02:00" }));

  assert.strictEqual(state.state, "underway");
  assert.strictEqual(state.countdownTo, WINDOW_START);
  assert.strictEqual(state.progress, 0.5);
});

test('a van seen on the road by an app that did not write the moment down fills from the last hour', () => {
  const state = deriveDeliveryState(stored({ position: ON_THE_ROAD, underwayAt: null, now: "2026-07-28T15:45:00.000+02:00" }));

  assert.strictEqual(state.state, "underway");
  assert.strictEqual(state.progress, 0.75);
});

test('a van that just left starts the bar at zero', () => {
  const state = deriveDeliveryState(stored({ position: ON_THE_ROAD, underwayAt: "2026-07-28T15:50:00.000+02:00", now: "2026-07-28T15:50:00.000+02:00" }));

  assert.strictEqual(state.progress, 0);
});

test('the live window from the road beats the announced one', () => {
  const live = { inProgress: true, etaStart: "2026-07-28T16:20:00.000+02:00", etaEnd: "2026-07-28T16:40:00.000+02:00" };
  const state = deriveDeliveryState(stored({ position: live, underwayAt: "2026-07-28T15:40:00.000+02:00", now: "2026-07-28T16:05:00.000+02:00" }));

  // past the announced start, but the van says it is still on its way
  assert.strictEqual(state.state, "underway");
  assert.strictEqual(state.countdownTo, "2026-07-28T16:20:00.000+02:00");
  assert.strictEqual(state.etaEnd, "2026-07-28T16:40:00.000+02:00");
  assert.strictEqual(state.progress, 0.625);
});

test('a route that is not being driven is not a van on its way', () => {
  const state = deriveDeliveryState(stored({ position: { inProgress: false, etaStart: WINDOW_START, etaEnd: WINDOW_END }, underwayAt: null }));

  assert.strictEqual(state.state, "announced");
  assert.strictEqual(state.progress, null);
});

test('a van on the road without a window of its own keeps the announced one', () => {
  const state = deriveDeliveryState(stored({ position: { inProgress: true, etaStart: null, etaEnd: null }, underwayAt: "2026-07-28T15:00:00.000+02:00" }));

  assert.strictEqual(state.state, "underway");
  assert.strictEqual(state.countdownTo, WINDOW_START);
  assert.strictEqual(state.progress, 0.5);
});

test('an order without a window says it was ordered and counts down to nothing', () => {
  const state = deriveDeliveryState(stored({ etaStart: null, etaEnd: null }));

  assert.strictEqual(state.state, "ordered");
  assert.strictEqual(state.countdownTo, null);
});

test('the window itself has the groceries arriving', () => {
  const state = deriveDeliveryState(stored({ now: "2026-07-28T16:15:00.000+02:00" }));

  assert.strictEqual(state.state, "arriving");
  assert.strictEqual(state.countdownTo, null);
  assert.strictEqual(state.progress, 0.25);
});

test('the start of the window is already arriving rather than a countdown of zero', () => {
  const state = deriveDeliveryState(stored({ now: WINDOW_START }));

  assert.strictEqual(state.state, "arriving");
  assert.strictEqual(state.progress, 0);
});

test('an order still open past its window is overdue', () => {
  const state = deriveDeliveryState(stored({ now: "2026-07-28T17:20:00.000+02:00" }));

  assert.strictEqual(state.state, "overdue");
  assert.strictEqual(state.progress, 1);
});

test('a window without an end is overdue once its start has passed', () => {
  const state = deriveDeliveryState(stored({ etaEnd: null, now: "2026-07-28T16:15:00.000+02:00" }));

  assert.strictEqual(state.state, "overdue");
});

test('groceries that just arrived are shown as delivered', () => {
  const state = deriveDeliveryState(stored({
    orderStatus: "groceries_delivered",
    deliveredAt: "2026-07-28T16:18:00.000+02:00",
    now: "2026-07-28T16:30:00.000+02:00"
  }));

  assert.strictEqual(state.state, "delivered");
  assert.strictEqual(state.deliveredAt, "2026-07-28T16:18:00.000+02:00");
});

test('a delivery from this morning is gone by the evening', () => {
  const state = deriveDeliveryState(stored({
    orderStatus: "groceries_delivered",
    deliveredAt: "2026-07-28T09:00:00.000+02:00",
    now: "2026-07-28T20:00:00.000+02:00"
  }));

  assert.strictEqual(state.state, "empty");
});

test('a delivery moment that cannot be read leaves the widget empty rather than delivered', () => {
  const state = deriveDeliveryState(stored({
    orderStatus: "groceries_delivered",
    deliveredAt: "not a timestamp",
    now: "2026-07-28T20:00:00.000+02:00"
  }));

  assert.strictEqual(state.state, "empty");
});

test('an unreadable window is treated as no window at all', () => {
  const state = deriveDeliveryState(stored({ etaStart: "whenever", etaEnd: "whenever" }));

  assert.strictEqual(state.state, "ordered");
  assert.strictEqual(state.countdownTo, null);
});

test('an order that can still be changed carries the moment it closes', () => {
  const state = deriveDeliveryState(stored({
    orderStatus: "groceries_ordered",
    cutOffAt: "2026-07-28T14:00:00.000+02:00",
    now: "2026-07-28T10:00:00.000+02:00"
  }));

  assert.strictEqual(state.cutOffAt, "2026-07-28T14:00:00.000+02:00");
});

test('a cut off that has passed is not carried any further', () => {
  const state = deriveDeliveryState(stored({
    orderStatus: "groceries_ordered",
    cutOffAt: "2026-07-28T14:00:00.000+02:00",
    now: "2026-07-28T14:00:01.000+02:00"
  }));

  assert.strictEqual(state.cutOffAt, null);
});

test('a delivery on its way is past changing, whatever the stored cut off says', () => {
  const state = deriveDeliveryState(stored({
    cutOffAt: "2026-07-28T23:00:00.000+02:00",
    now: "2026-07-28T16:15:00.000+02:00"
  }));

  assert.strictEqual(state.state, "arriving");
  assert.strictEqual(state.cutOffAt, null);
});

test('a delivered order left no cut off behind', () => {
  const state = deriveDeliveryState(stored({
    orderStatus: "groceries_delivered",
    deliveredAt: "2026-07-28T16:18:00.000+02:00",
    cutOffAt: "2026-07-28T23:00:00.000+02:00",
    now: "2026-07-28T16:30:00.000+02:00"
  }));

  assert.strictEqual(state.cutOffAt, null);
});

test('an unreadable cut off is left out rather than shown as a moment in 1970', () => {
  const state = deriveDeliveryState(stored({
    orderStatus: "groceries_ordered",
    cutOffAt: "any time now",
    now: "2026-07-28T10:00:00.000+02:00"
  }));

  assert.strictEqual(state.cutOffAt, null);
});

test('a state Picnic has not confirmed in over a day is not shown as current', () => {
  const state = deriveDeliveryState(stored({
    etaStart: "2026-04-05T09:04:00.000+02:00",
    etaEnd: "2026-04-05T09:24:00.000+02:00",
    checkedAt: "2026-04-05T08:00:00.000+02:00",
    now: "2026-09-17T11:42:00.000+02:00"
  }));

  assert.strictEqual(state.state, "stale");
  assert.strictEqual(state.checkedAt, "2026-04-05T08:00:00.000+02:00");
  assert.strictEqual(state.etaStart, null);
  assert.strictEqual(state.countdownTo, null);
});

test('a state Picnic never confirmed is not shown as current either', () => {
  const state = deriveDeliveryState(stored({ checkedAt: null }));

  assert.strictEqual(state.state, "stale");
  assert.strictEqual(state.checkedAt, null);
});

test('a poll missed here and there leaves the state as it is', () => {
  const state = deriveDeliveryState(stored({ checkedAt: "2026-07-28T03:30:00.000+02:00" }));

  assert.strictEqual(state.state, "announced");
});

test('a sign in that is needed is said before the state is called out of date', () => {
  const state = deriveDeliveryState(stored({ signInNeeded: true, checkedAt: null }));

  assert.strictEqual(state.state, "signed_out");
});

test('an order the app only sees gone months after its window is not shown as just delivered', () => {
  const state = deriveDeliveryState(stored({
    orderStatus: "groceries_delivered",
    etaStart: "2026-04-05T09:04:00.000+02:00",
    etaEnd: "2026-04-05T09:24:00.000+02:00",
    deliveredAt: "2026-09-17T11:42:00.000+02:00",
    now: "2026-09-17T11:50:00.000+02:00"
  }));

  assert.strictEqual(state.state, "empty");
});

test('groceries delivered a little after their window still show as delivered', () => {
  const state = deriveDeliveryState(stored({
    orderStatus: "groceries_delivered",
    deliveredAt: "2026-07-28T17:40:00.000+02:00",
    now: "2026-07-28T17:45:00.000+02:00"
  }));

  assert.strictEqual(state.state, "delivered");
});

test('a delivery stays on the widget for four hours and then makes way', () => {
  const delivered = { orderStatus: "groceries_delivered", deliveredAt: "2026-07-28T16:18:00.000+02:00" };

  assert.strictEqual(deriveDeliveryState(stored(Object.assign({ now: "2026-07-28T20:17:00.000+02:00" }, delivered))).state, "delivered");
  assert.strictEqual(deriveDeliveryState(stored(Object.assign({ now: "2026-07-28T20:19:00.000+02:00" }, delivered))).state, "empty");
});

test('a delivered order carries what Picnic said about it, deposit included', () => {
  const state = deriveDeliveryState(stored({
    orderStatus: "groceries_delivered",
    deliveredAt: "2026-07-28T16:18:00.000+02:00",
    delivery: { totalPrice: 22.03, depositReturned: 4.8, returned: [{ name: "Flessen", quantity: 6, amount: 0.9 }] },
    now: "2026-07-28T16:30:00.000+02:00"
  }));

  assert.deepStrictEqual(state.delivery, { totalPrice: 22.03, depositReturned: 4.8, returned: [{ name: "Flessen", quantity: 6, amount: 0.9 }] });
});

const CART = {
  totalPrice: 22.03,
  productCount: 9,
  minimumOrderValue: 35,
  slot: { chosen: true, windowStart: "2026-07-30T18:15:00.000+02:00", windowEnd: "2026-07-30T19:15:00.000+02:00", cutOffAt: "2026-07-29T23:00:00.000+02:00" }
};

test('with nothing ordered, a cart with something in it is what the widget shows', () => {
  const state = deriveDeliveryState(stored({ orderStatus: "", cart: CART }));

  assert.strictEqual(state.state, "cart");
  assert.strictEqual(state.cart.totalPrice, 22.03);
  assert.strictEqual(state.cart.minimumShort, 12.97);
  assert.strictEqual(state.cart.slotChosen, true);
  assert.deepStrictEqual(state.cart.slot, {
    windowStart: CART.slot.windowStart,
    windowEnd: CART.slot.windowEnd,
    cutOffAt: CART.slot.cutOffAt
  });
});

test('a slot Picnic suggested by itself is not named', () => {
  const state = deriveDeliveryState(stored({ orderStatus: "", cart: Object.assign({}, CART, { slot: Object.assign({}, CART.slot, { chosen: false }) }) }));

  assert.strictEqual(state.cart.slotChosen, false);
  assert.strictEqual(state.cart.slot, null);
});

test('a chosen slot whose ordering deadline passed keeps its window but not its deadline', () => {
  const state = deriveDeliveryState(stored({ orderStatus: "", cart: CART, now: "2026-07-29T23:30:00.000+02:00" }));

  assert.strictEqual(state.cart.slot.cutOffAt, null);
  assert.strictEqual(state.cart.slot.windowStart, CART.slot.windowStart);
  assert.strictEqual(state.cart.slotClosed, true);
});

test('a chosen slot that can still be ordered for is not closed', () => {
  const state = deriveDeliveryState(stored({ orderStatus: "", cart: CART }));

  assert.strictEqual(state.cart.slotClosed, false);
});

test('an empty cart is the empty state, and says the cart was looked at', () => {
  const state = deriveDeliveryState(stored({ orderStatus: "", cart: { totalPrice: 0, productCount: 0 } }));

  assert.strictEqual(state.state, "empty");
  assert.strictEqual(state.cartKnown, true);
  assert.strictEqual(deriveDeliveryState(stored({ orderStatus: "" })).cartKnown, false);
});

test('a delivery just made is shown before the next cart', () => {
  const state = deriveDeliveryState(stored({
    orderStatus: "groceries_delivered",
    deliveredAt: "2026-07-28T16:18:00.000+02:00",
    cart: CART,
    now: "2026-07-28T16:30:00.000+02:00"
  }));

  assert.strictEqual(state.state, "delivered");
});

test('the cart only rides along with an order while that order can still be added to', () => {
  const open = deriveDeliveryState(stored({ orderStatus: "groceries_ordered", cart: CART, cutOffAt: "2026-07-28T15:45:00.000+02:00" }));
  const closed = deriveDeliveryState(stored({ orderStatus: "groceries_ordered", cart: CART, cutOffAt: "2026-07-28T15:00:00.000+02:00" }));

  assert.strictEqual(open.cart.totalPrice, 22.03);
  assert.strictEqual(closed.cart, null);
});

test('a delivery the app cannot place in time is not shown as one', () => {
  // what a sign-in on an account with nothing running used to leave behind:
  // a delivered status stamped with the moment the app first looked
  const state = deriveDeliveryState(stored({
    orderStatus: "groceries_delivered",
    etaStart: null,
    etaEnd: null,
    deliveredAt: "2026-07-28T08:46:00.000+02:00",
    now: "2026-07-28T09:00:00.000+02:00"
  }));

  assert.strictEqual(state.state, "empty");
});

test('a delivery Picnic itself put a moment on is shown without a window', () => {
  const state = deriveDeliveryState(stored({
    orderStatus: "groceries_delivered",
    etaStart: null,
    etaEnd: null,
    deliveredAt: "2026-07-28T08:46:00.000+02:00",
    delivery: { deliveredAt: "2026-07-28T08:46:00.000+02:00", totalPrice: 22.03, depositReturned: null, returned: [] },
    now: "2026-07-28T09:00:00.000+02:00"
  }));

  assert.strictEqual(state.state, "delivered");
});

const NOW_MS = Date.parse("2026-09-18T12:32:00.000+02:00");
const AGO = (minutes) => new Date(NOW_MS - minutes * 60 * 1000).toISOString();

test('with no order being followed, Picnic is asked about orders once the last answer is five minutes old', () => {
  ["empty", "cart", "delivered", "stale"].forEach(state => {
    assert.strictEqual(orderCheckDue(state, AGO(4), NOW_MS, false), false, state + " at four minutes");
    assert.strictEqual(orderCheckDue(state, AGO(5), NOW_MS, false), true, state + " at five minutes");
  });
  assert.strictEqual(ORDER_MAX_AGE, 5 * 60 * 1000);
});

test('an app that never heard from Picnic asks right away', () => {
  assert.strictEqual(orderCheckDue("empty", null, NOW_MS, false), true);
});

test('a cart that was just emptied is asked about right away, however recent the last answer', () => {
  assert.strictEqual(orderCheckDue("empty", AGO(0), NOW_MS, true), true);
});

test('an order already being followed is left to the poll, and a signed out app cannot ask', () => {
  ["ordered", "announced", "arriving", "overdue", "signed_out"].forEach(state => {
    assert.strictEqual(orderCheckDue(state, AGO(60), NOW_MS, true), false, state);
  });
});

test('an order placed after the last delivery shows with the deadline to add to it', () => {
  // the state the poll leaves once it has found the order: tomorrow 08:30 to
  // 09:30, closing today at 13:00, with nothing in the cart
  const state = deriveDeliveryState({
    orderStatus: "groceries_ordered",
    etaStart: "2026-09-19T08:30:00.000+02:00",
    etaEnd: "2026-09-19T09:30:00.000+02:00",
    cutOffAt: "2026-09-18T13:00:00.000+02:00",
    checkedAt: "2026-09-18T12:32:00.000+02:00",
    cart: { totalPrice: 0, productCount: 0 },
    now: "2026-09-18T12:32:00.000+02:00"
  });

  assert.strictEqual(state.state, "ordered");
  assert.strictEqual(state.countdownTo, "2026-09-19T08:30:00.000+02:00");
  assert.strictEqual(state.cutOffAt, "2026-09-18T13:00:00.000+02:00");
  // an empty cart has nothing still to add
  assert.strictEqual(state.cart, null);
});

test('the next day with an open slot comes along in every state, full cart or empty', () => {
  const next = { windowStart: '2026-09-19T08:30:00.000+02:00', windowEnd: '2026-09-19T09:30:00.000+02:00', available: 3, total: 12 };

  const empty = deriveDeliveryState({ orderStatus: '', cart: { totalPrice: 0, productCount: 0, nextSlots: next }, checkedAt: '2026-09-18T10:00:00.000+02:00', now: '2026-09-18T10:00:00.000+02:00' });
  assert.strictEqual(empty.state, 'empty');
  assert.deepStrictEqual(empty.nextSlots, next);

  const full = deriveDeliveryState({ orderStatus: '', cart: { totalPrice: 21.15, productCount: 7, nextSlots: next }, checkedAt: '2026-09-18T10:00:00.000+02:00', now: '2026-09-18T10:00:00.000+02:00' });
  assert.strictEqual(full.state, 'cart');
  assert.deepStrictEqual(full.nextSlots, next);
});

test('a next day the cart cannot vouch for is left out', () => {
  const at = { checkedAt: '2026-09-18T10:00:00.000+02:00', now: '2026-09-18T10:00:00.000+02:00' };

  assert.strictEqual(deriveDeliveryState(Object.assign({ orderStatus: '', cart: null }, at)).nextSlots, null);
  assert.strictEqual(deriveDeliveryState(Object.assign({ orderStatus: '', cart: { totalPrice: 0, productCount: 0, nextSlots: { windowStart: 'soon', available: 3, total: 12 } } }, at)).nextSlots, null);
  assert.strictEqual(deriveDeliveryState(Object.assign({ orderStatus: '', cart: { totalPrice: 0, productCount: 0, nextSlots: { windowStart: '2026-09-19T08:30:00.000+02:00', available: 0, total: 12 } } }, at)).nextSlots, null);
});
