'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { refusal, hasCode, picnicErrorCode, UNAUTHORIZED, SECOND_FACTOR_REQUIRED } = require('../lib/refusal.js');
const { toError } = require('../lib/errors.js');

// what Picnic answered a real account with
const SECOND_FACTOR_BODY = '{"error":{"code":"TWO_FACTOR_AUTHENTICATION_REQUIRED","message":"User must verify their second factor","details":{}}}';

test('an answer that went through is not a refusal', () => {
  assert.strictEqual(refusal(200, '[]', "the order"), null);
});

test('a token waiting on its second factor is told apart from a rejected one', () => {
  const refused = refusal(403, SECOND_FACTOR_BODY, "the order");

  assert.strictEqual(refused.code, SECOND_FACTOR_REQUIRED);
  assert.strictEqual(refused.statusCode, 403);
  assert.ok(hasCode(refused, SECOND_FACTOR_REQUIRED));
  assert.ok(!hasCode(refused, UNAUTHORIZED));
});

test('a rejected token still reads as unauthorized for the poll', () => {
  const refused = refusal(401, '', "the order");

  assert.strictEqual(String(refused), "Error: unauthorized");
  assert.strictEqual(refused.code, UNAUTHORIZED);
});

test('any other refusal says what Picnic answered', () => {
  const refused = refusal(503, '<html>down</html>', "the cart");

  assert.strictEqual(refused.message, "Picnic refused to hand out the cart: <html>down</html>");
  assert.strictEqual(refused.code, undefined);
});

test('the code is found on a failure that was wrapped on its way up', () => {
  const wrapped = toError(refusal(403, SECOND_FACTOR_BODY, "the order"), "The order status could not be retrieved");

  assert.ok(hasCode(wrapped, SECOND_FACTOR_REQUIRED));
});

test('a body that is not Picnic json has no code', () => {
  assert.strictEqual(picnicErrorCode('not json'), null);
  assert.strictEqual(picnicErrorCode('{"error":{}}'), null);
  assert.strictEqual(picnicErrorCode(undefined), null);
  assert.strictEqual(hasCode("Error: unauthorized", UNAUTHORIZED), false);
});
