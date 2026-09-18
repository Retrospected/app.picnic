'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { parseDelivery } = require('../lib/deliveryresponse.js');

// shaped after a captured GET /api/15/deliveries/{id}
function delivery(extra) {
  return JSON.stringify(Object.assign({
    type: "DELIVERY",
    delivery_id: "d1",
    status: "COMPLETED",
    delivery_time: { start: "2026-09-17T11:27:17.942+02:00", end: "2026-09-17T11:30:53.437+02:00" },
    orders: [
      { total_price: 2207, checkout_total_price: 2203, total_deposit: 39 },
      { total_price: 500, checkout_total_price: 500, total_deposit: 0 }
    ],
    returned_containers: []
  }, extra));
}

test('a delivery says when it actually arrived and what it cost', () => {
  const parsed = parseDelivery(delivery());

  assert.strictEqual(parsed.deliveryId, "d1");
  assert.strictEqual(parsed.deliveredAt, "2026-09-17T11:27:17.942+02:00");
  assert.strictEqual(parsed.totalPrice, 27.03);
  assert.strictEqual(parsed.depositPaid, 0.39);
});

test('deposit not counted yet is unknown rather than nothing', () => {
  const parsed = parseDelivery(delivery());

  assert.strictEqual(parsed.depositReturned, null);
  assert.deepStrictEqual(parsed.returned, []);
});

test('returned containers add up to the deposit that comes back', () => {
  const parsed = parseDelivery(delivery({
    returned_containers: [
      { type: "BOTTLE", localized_name: "Flessen", quantity: 6, price: 15 },
      { type: "CRATE", localized_name: "Kratten", quantity: 1, price: 390 },
      { type: "BAG", localized_name: "Tassen", quantity: 0, price: 39 }
    ]
  }));

  assert.strictEqual(parsed.depositReturned, 4.8);
  assert.deepStrictEqual(parsed.returned, [
    { name: "Flessen", quantity: 6, amount: 0.9 },
    { name: "Kratten", quantity: 1, amount: 3.9 }
  ]);
});

test('a delivery without a delivery time has not arrived as far as this says', () => {
  assert.strictEqual(parseDelivery(delivery({ delivery_time: null })).deliveredAt, null);
});

test('an answer that is not a delivery is nothing', () => {
  assert.strictEqual(parseDelivery("<html>"), null);
  assert.strictEqual(parseDelivery("[]"), null);
  assert.strictEqual(parseDelivery(JSON.stringify({})).totalPrice, null);
});

test('the products in an order are counted by the quantity on each article, across every order', () => {
  const article = (quantity) => ({ decorators: [{ type: "UNIT_QUANTITY" }, { type: "QUANTITY", quantity: quantity }] });
  const parsed = parseDelivery(delivery({
    orders: [
      { checkout_total_price: 5184, items: [{ items: [article(3)] }, { items: [article(1)] }] },
      // what was added after the order was placed arrives as an order of its own
      { checkout_total_price: 159, items: [{ items: [article(1)] }] }
    ]
  }));

  assert.strictEqual(parsed.productCount, 5);
  assert.strictEqual(parsed.totalPrice, 53.43);
});

test('an article without a quantity on it counts once', () => {
  assert.strictEqual(parseDelivery(delivery({ orders: [{ items: [{ items: [{}] }] }] })).productCount, 1);
});

test('a delivery without its lines has no count rather than a count of nothing', () => {
  assert.strictEqual(parseDelivery(delivery()).productCount, null);
});
