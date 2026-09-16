'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { verificationPending, awaitingVerification, codeIsUsable, CODE_VALIDITY } = require('../lib/twofactor.js');

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

test('a code that was just sent is worth typing in', () => {
  assert.strictEqual(codeIsUsable(pending(), NOW), true);
});

test('a code stops being worth typing in once it has expired', () => {
  assert.strictEqual(codeIsUsable(pending({ codeRequestedAt: NOW - CODE_VALIDITY + 1 }), NOW), true);
  assert.strictEqual(codeIsUsable(pending({ codeRequestedAt: NOW - CODE_VALIDITY }), NOW), false);
});

// the phone was in another room and the code died of old age: what is left to
// do about that is a new sign-in, not a field to type the old code into
test('an expired code is still waited on, it is just not offered any more', () => {
  const expired = pending({ codeRequestedAt: NOW - CODE_VALIDITY - 1 });

  assert.strictEqual(awaitingVerification(expired), true);
  assert.strictEqual(codeIsUsable(expired, NOW), false);
});

test('a code that was never sent is never worth typing in', () => {
  assert.strictEqual(codeIsUsable(pending({ codeRequestedAt: undefined }), NOW), false);
  assert.strictEqual(codeIsUsable({}, NOW), false);
});

test('a clock that moved backwards does not expire a fresh code', () => {
  assert.strictEqual(codeIsUsable(pending({ codeRequestedAt: NOW + CODE_VALIDITY }), NOW), true);
});
