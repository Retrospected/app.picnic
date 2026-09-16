'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { verificationPending, awaitingVerification, shouldRequestCode, CODE_COOLDOWN } = require('../lib/twofactor.js');

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
});

// the login stored the pending state and the request for a code then failed,
// which used to leave the app waiting for a text message nobody ever got
test('a code that was never sent is not worth waiting for', () => {
  assert.strictEqual(awaitingVerification(pending({ codeRequestedAt: undefined })), false);
  assert.strictEqual(awaitingVerification(pending({ codeRequestedAt: "not a moment" })), false);
  assert.strictEqual(awaitingVerification(pending({ codeRequestedAt: 0 })), false);
});

test('a code without the token it verifies against is not worth waiting for', () => {
  assert.strictEqual(awaitingVerification({ pendingFlag: true, codeRequestedAt: NOW - 1000 }), false);
});

test('a login that needs a second factor asks for a code when none is waiting', () => {
  assert.strictEqual(shouldRequestCode({}, NOW), true);
});

test('a code sent a moment ago is not worth another SMS', () => {
  assert.strictEqual(shouldRequestCode(pending(), NOW), false);
});

test('a code stops counting once the cooldown has passed', () => {
  assert.strictEqual(shouldRequestCode(pending({ codeRequestedAt: NOW - CODE_COOLDOWN + 1 }), NOW), false);
  assert.strictEqual(shouldRequestCode(pending({ codeRequestedAt: NOW - CODE_COOLDOWN }), NOW), true);
});

test('a code without the token it verifies against is useless', () => {
  assert.strictEqual(shouldRequestCode({ pendingFlag: true, codeRequestedAt: NOW - 1000 }, NOW), true);
});

test('a code of unknown age counts as gone', () => {
  assert.strictEqual(shouldRequestCode(pending({ codeRequestedAt: undefined }), NOW), true);
  assert.strictEqual(shouldRequestCode(pending({ codeRequestedAt: "not a moment" }), NOW), true);
  assert.strictEqual(shouldRequestCode(pending({ codeRequestedAt: 0 }), NOW), true);
});

test('a clock that moved backwards does not lock anyone out of a code', () => {
  assert.strictEqual(shouldRequestCode(pending({ codeRequestedAt: NOW + CODE_COOLDOWN }), NOW), true);
});
