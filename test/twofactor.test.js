'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { verificationPending, awaitingVerification } = require('../lib/twofactor.js');

const NOW = 1758000000000;

function pending(extra) {
  return Object.assign({
    pendingToken: "a-pending-token",
    pendingFlag: true,
    codeRequestedAt: NOW - 1000
  }, extra);
}

test('nothing is pending without a token or a flag', () => {
  assert.strictEqual(verificationPending({}), false);
  assert.strictEqual(verificationPending({ pendingToken: "", pendingFlag: false }), false);
});

test('a state that could not be read is not pending', () => {
  assert.strictEqual(verificationPending(undefined), false);
  assert.strictEqual(verificationPending(null), false);
});

test('either a pending token or the flag means a code is waiting', () => {
  assert.strictEqual(verificationPending({ pendingToken: "a-pending-token" }), true);
  assert.strictEqual(verificationPending({ pendingFlag: true }), true);
});

test('a code that was sent and can still be verified is worth waiting for', () => {
  assert.strictEqual(awaitingVerification(pending()), true);
});

test('nothing is awaited when no 2FA is going on at all', () => {
  assert.strictEqual(awaitingVerification({}), false);
  assert.strictEqual(awaitingVerification(undefined), false);
});

// the sign-in stored the pending state and the request for a code then failed,
// which would otherwise leave the app waiting on a text message nobody got
test('a code that was never sent is not worth waiting for', () => {
  assert.strictEqual(awaitingVerification(pending({ codeRequestedAt: undefined })), false);
  assert.strictEqual(awaitingVerification(pending({ codeRequestedAt: "not a moment" })), false);
  assert.strictEqual(awaitingVerification(pending({ codeRequestedAt: 0 })), false);
});

test('a code without the token it verifies against is not worth waiting for', () => {
  assert.strictEqual(awaitingVerification({ pendingFlag: true, codeRequestedAt: NOW - 1000 }), false);
});

test('a code stays worth waiting for however old it is', () => {
  // only the user can replace it, by signing in again: giving up on the wait
  // here is what would have the app ask Picnic for another SMS
  assert.strictEqual(awaitingVerification(pending({ codeRequestedAt: 1 })), true);
});
