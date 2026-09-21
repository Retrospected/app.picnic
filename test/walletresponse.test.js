'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { parseTransactions, parseTransaction } = require('../lib/walletresponse.js');

test('the wallet lists its payments newest first, in euros', () => {
  const payments = parseTransactions(JSON.stringify([
    { id: "t2", amount_in_cents: -5189, status: "SUCCEEDED", timestamp: 1790000000000 },
    { id: "t1", amount_in_cents: 4680, status: "SUCCEEDED" },
    { amount_in_cents: 100 }
  ]));

  assert.deepStrictEqual(payments, [
    { id: "t2", amount: 51.89, status: "SUCCEEDED" },
    { id: "t1", amount: 46.8, status: "SUCCEEDED" }
  ]);
});

test('a payment says which delivery it was for and how much was taken', () => {
  assert.deepStrictEqual(parseTransaction(JSON.stringify({
    delivery_id: "d1",
    amount_in_cents: -5189,
    transaction_status: "SUCCEEDED",
    refunded_items: [],
    article_issue_refunds: []
  })), { deliveryId: "d1", amount: 51.89, status: "SUCCEEDED" });
});

test('a payment that is not for a delivery, or has no amount, is nothing to go by', () => {
  assert.strictEqual(parseTransaction(JSON.stringify({ amount_in_cents: 500 })), null);
  assert.strictEqual(parseTransaction(JSON.stringify({ delivery_id: "d1" })), null);
});

test('an answer that is not a wallet is nothing', () => {
  assert.strictEqual(parseTransactions("<html>"), null);
  assert.strictEqual(parseTransactions(JSON.stringify({})), null);
  assert.strictEqual(parseTransaction("<html>"), null);
  assert.strictEqual(parseTransaction("[]"), null);
});
