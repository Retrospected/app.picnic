'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { parseAddProductResponse } = require('../lib/cartresponse.js');

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
