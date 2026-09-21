'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { parseAddProductResponse, parseCart } = require('../lib/cartresponse.js');

const PRODUCT = "s1004234";

function cart(lines) {
  return JSON.stringify({ items: [{ items: lines }] });
}

test('reports the name of the product that was added', () => {
  const outcome = parseAddProductResponse(cart([{ id: PRODUCT, name: "Bananen" }]), PRODUCT);

  assert.strictEqual(outcome["name"], "Bananen");
  assert.strictEqual(outcome["error"], undefined);
});

test('finds the product between other products in the cart', () => {
  const body = JSON.stringify({
    items: [
      { items: [{ id: "s999", name: "Melk" }] },
      { items: [{ id: "s888", name: "Brood" }, { id: PRODUCT, name: "Bananen" }] }
    ]
  });

  assert.strictEqual(parseAddProductResponse(body, PRODUCT)["name"], "Bananen");
});

test('accepts a product id that comes back as a number', () => {
  const outcome = parseAddProductResponse(cart([{ id: 1004234, name: "Bananen" }]), "1004234");

  assert.strictEqual(outcome["name"], "Bananen");
});

// Picnic answers with the whole cart and an error code when the product is
// already in it, and the product being there is what the flow asked for
test('reports the name when the cart comes with an error code', () => {
  const body = JSON.stringify({
    error: { code: "UNPROCESSABLE_ENTITY" },
    items: [{ items: [{ id: PRODUCT, name: "Bananen" }] }]
  });

  assert.strictEqual(parseAddProductResponse(body, PRODUCT)["name"], "Bananen");
});

test('reports a locked cart when the error code comes without a cart', () => {
  const outcome = parseAddProductResponse(JSON.stringify({ error: { code: "UNPROCESSABLE_ENTITY" } }), PRODUCT);

  assert.strictEqual(outcome["name"], undefined);
  assert.strictEqual(outcome["error"], "Cart was locked");
});

test('reports a problem when the cart does not mention the product', () => {
  const outcome = parseAddProductResponse(cart([{ id: "s999", name: "Melk" }]), PRODUCT);

  assert.strictEqual(outcome["name"], undefined);
  assert.strictEqual(outcome["error"], "Unexpected response from server");
});

test('keeps an error code it does not know for the log', () => {
  const outcome = parseAddProductResponse(JSON.stringify({ error: { code: "SOMETHING_NEW" } }), PRODUCT);

  assert.strictEqual(outcome["error"], "Unexpected response from server");
  assert.strictEqual(outcome["code"], "SOMETHING_NEW");
});

// every one of these used to throw inside the response handler, where nothing
// catches it, which took the app down and restarted it
test('does not throw on an answer that makes no sense', () => {
  const nonsense = [
    ["an empty body", ""],
    ["a body that is not json", "<html>502 Bad Gateway</html>"],
    ["a json null", "null"],
    ["a json string", '"nope"'],
    ["a json number", "42"],
    ["an object without items or error", "{}"],
    ["an error without a code", '{"error":{}}'],
    ["an error that is not an object", '{"error":"nope"}'],
    ["items that are not an array", '{"items":"nope"}'],
    ["an empty cart", '{"items":[]}'],
    ["a group without lines", '{"items":[{}]}'],
    ["a group whose lines are not an array", '{"items":[{"items":"nope"}]}'],
    ["a group with an empty line list", '{"items":[{"items":[]}]}'],
    ["a line that is null", '{"items":[{"items":[null]}]}'],
    ["a line without an id", '{"items":[{"items":[{"name":"Bananen"}]}]}'],
    ["a matching line without a name", '{"items":[{"items":[{"id":"' + PRODUCT + '"}]}]}']
  ];

  nonsense.forEach(([description, body]) => {
    const outcome = parseAddProductResponse(body, PRODUCT);

    assert.strictEqual(outcome["name"], undefined, description + " should not report a product");
    assert.ok(outcome["error"], description + " should report a problem");
  });
});

test('does not throw on a body that is not a string', () => {
  [undefined, null, 0, {}, []].forEach(body => {
    assert.ok(parseAddProductResponse(body, PRODUCT)["error"]);
  });
});

test('a cart reports what it is worth and how much is in it', () => {
  const cart = parseCart(JSON.stringify({ total_price: 4320, total_count: 12, minimum_order_value: 3500 }));

  assert.deepStrictEqual(cart, { totalPrice: 43.2, productCount: 12, minimumOrderValue: 35, slot: null, nextSlots: null });
});

test('a cart that does not total itself up is counted line by line', () => {
  const cart = parseCart(JSON.stringify({
    total_price: 1000,
    items: [{ items: [{ id: "a", count: 2 }, { id: "b" }] }, { items: [{ id: "c", count: 3 }] }]
  }));

  assert.strictEqual(cart.productCount, 6);
});

test('an empty cart is empty rather than unknown', () => {
  const cart = parseCart(JSON.stringify({ total_price: 0, items: [] }));

  assert.strictEqual(cart.productCount, 0);
  assert.strictEqual(cart.totalPrice, 0);
});

test('the minimum order value is looked for on the slot as well as on the cart', () => {
  const cart = parseCart(JSON.stringify({
    total_price: 1000,
    selected_slot: { slot_id: "s2" },
    delivery_slots: [{ slot_id: "s1", minimum_order_value: 1000 }, { slot_id: "s2", minimum_order_value: 3500 }]
  }));

  assert.strictEqual(cart.minimumOrderValue, 35);
});

test('a minimum order value Picnic does not mention is not invented', () => {
  const cart = parseCart(JSON.stringify({ total_price: 1000 }));

  assert.strictEqual(cart.minimumOrderValue, null);
});

test('amounts that are not numbers leave the widget with nothing to show', () => {
  const cart = parseCart(JSON.stringify({ total_price: "43.20" }));

  assert.strictEqual(cart.totalPrice, null);
});

test('a cart that is not json at all is not a cart', () => {
  assert.strictEqual(parseCart("<html>nope</html>"), null);
  assert.strictEqual(parseCart(JSON.stringify([])), null);
});

const SLOTS = [
  { slot_id: "s1", window_start: "2026-09-18T08:00:00.000+02:00", window_end: "2026-09-18T09:00:00.000+02:00", cut_off_time: "2026-09-17T13:00:00.000+02:00", minimum_order_value: 3500 },
  { slot_id: "s2", window_start: "2026-09-19T18:15:00.000+02:00", window_end: "2026-09-19T19:15:00.000+02:00", cut_off_time: "2026-09-18T23:00:00.000+02:00", minimum_order_value: 4500 }
];

test('a slot picked in the app is the chosen delivery moment', () => {
  const cart = parseCart(JSON.stringify({ total_price: 2203, selected_slot: { slot_id: "s2", state: "EXPLICIT" }, delivery_slots: SLOTS }));

  assert.deepStrictEqual(cart.slot, {
    chosen: true,
    windowStart: "2026-09-19T18:15:00.000+02:00",
    windowEnd: "2026-09-19T19:15:00.000+02:00",
    cutOffAt: "2026-09-18T23:00:00.000+02:00"
  });
  assert.strictEqual(cart.minimumOrderValue, 45);
});

test('the slot Picnic suggests by itself is not a chosen one', () => {
  const cart = parseCart(JSON.stringify({ total_price: 2203, selected_slot: { slot_id: "s1", state: "IMPLICIT" }, delivery_slots: SLOTS }));

  assert.strictEqual(cart.slot.chosen, false);
  assert.strictEqual(cart.minimumOrderValue, 35);
});

test('a selected slot missing from the list still says whether it was chosen', () => {
  const cart = parseCart(JSON.stringify({ total_price: 2203, selected_slot: { slot_id: "gone", state: "EXPLICIT" }, delivery_slots: SLOTS }));

  assert.deepStrictEqual(cart.slot, { chosen: true, windowStart: null, windowEnd: null, cutOffAt: null });
});

test('the cart is worth what the checkout says it is worth', () => {
  const cart = parseCart(JSON.stringify({ total_price: 2207, checkout_total_price: 2203, total_count: 9 }));

  assert.strictEqual(cart.totalPrice, 22.03);
});

test('a cart that does not mention a checkout total is worth its total', () => {
  assert.strictEqual(parseCart(JSON.stringify({ total_price: 2207 })).totalPrice, 22.07);
});

// The two weeks of slots Picnic lists with the cart: the next day something
// can be delivered on, and how open that day is.
function slot(day, time, available) {
  return { slot_id: day + time, window_start: day + "T" + time + ":00.000+02:00", window_end: day + "T" + time.replace(/^(\d\d)/, (h) => String(Number(h) + 1).padStart(2, "0")) + ":00.000+02:00", is_available: available };
}

test('the next day with an open slot is counted, open and all', () => {
  const parsed = parseCart(JSON.stringify({
    total_price: 0,
    delivery_slots: [slot("2026-09-19", "08:30", true), slot("2026-09-19", "11:15", false), slot("2026-09-19", "14:30", true), slot("2026-09-20", "08:30", true)]
  }));

  assert.deepStrictEqual(parsed["nextSlots"], {
    windowStart: "2026-09-19T08:30:00.000+02:00",
    windowEnd: "2026-09-19T09:30:00.000+02:00",
    available: 2,
    total: 3
  });
});

test('a day with nothing open is passed over for the next one', () => {
  const parsed = parseCart(JSON.stringify({
    total_price: 0,
    // listed out of order too: Picnic's order is not relied on
    delivery_slots: [slot("2026-09-20", "14:30", true), slot("2026-09-19", "08:30", false), slot("2026-09-20", "08:30", true), slot("2026-09-19", "14:30", false)]
  }));

  assert.strictEqual(parsed["nextSlots"]["windowStart"], "2026-09-20T08:30:00.000+02:00");
  assert.strictEqual(parsed["nextSlots"]["available"], 2);
  assert.strictEqual(parsed["nextSlots"]["total"], 2);
});

test('no open slot at all, or no list, is no next day', () => {
  assert.strictEqual(parseCart(JSON.stringify({ total_price: 0, delivery_slots: [slot("2026-09-19", "08:30", false)] }))["nextSlots"], null);
  assert.strictEqual(parseCart(JSON.stringify({ total_price: 0 }))["nextSlots"], null);
  assert.strictEqual(parseCart(JSON.stringify({ total_price: 0, delivery_slots: [{ window_start: 5 }, null] }))["nextSlots"], null);
});
