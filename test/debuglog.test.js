'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { forLog } = require('../lib/debuglog.js');

test('amounts and moments are kept', () => {
  const logged = JSON.parse(forLog(JSON.stringify({
    total_price: 3314,
    checkout_total_price: 3314,
    total_savings: 1074,
    selected_slot: { slot_id: "s1", state: "EXPLICIT" },
    items: [{ price: 1798, display_price: 1649, decorators: [{ type: "PRICE", display_price: 1649 }] }]
  })));

  assert.strictEqual(logged.total_price, 3314);
  assert.strictEqual(logged.items[0].decorators[0].display_price, 1649);
  assert.strictEqual(logged.selected_slot.state, "EXPLICIT");
});

test('nothing that says who the order is for, or lets anyone act as them', () => {
  const logged = forLog(JSON.stringify({
    state_token: "eyJhbGciOi.secret",
    address: { street: "Dorpsstraat", house_number: 1, postcode: "1234AB", city: "Utrecht" },
    transaction_info: { redacted_iban: "NL00 **** 00", bank_id: "ABNA" },
    user_id: "u1",
    orders: [{ first_name: "R", total_price: 100 }]
  }));

  ["eyJhbGciOi", "Dorpsstraat", "1234AB", "Utrecht", "NL00", "ABNA", "\"u1\"", "\"R\""].forEach(secret => {
    assert.ok(!logged.includes(secret), "leaked " + secret + ": " + logged);
  });
  assert.ok(logged.includes('"total_price":100'));
});

test('bulk that says nothing about money or time is left out', () => {
  const logged = JSON.parse(forLog({ total_price: 1, analytics_context_data: { items_list: [1, 2, 3] }, image_ids: ["a"] }));

  assert.deepStrictEqual(Object.keys(logged), ["total_price"]);
});

test('an answer that is not json is shortened rather than dumped', () => {
  const html = "<html>" + "x".repeat(1000) + "</html>";

  assert.ok(forLog(html).length < 200);
});
