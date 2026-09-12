'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { describeError, describeStack, describeBody, toError, isError } = require('../lib/errors.js');

test('describes a plain Error by name and message', () => {
  assert.strictEqual(describeError(new Error("no route to host")), "Error: no route to host");
  assert.strictEqual(describeError(new TypeError("body is not a string")), "TypeError: body is not a string");
});

test('keeps the code a network failure carries, which is what names the problem', () => {
  const failure = new Error("connect ECONNREFUSED 1.2.3.4:443");
  failure.code = "ECONNREFUSED";

  assert.strictEqual(describeError(failure), "Error: connect ECONNREFUSED 1.2.3.4:443 (code ECONNREFUSED)");
});

test('keeps the status code Picnic answered with', () => {
  const refused = new Error("Picnic refused to hand out the order");
  refused.statusCode = 503;

  assert.strictEqual(describeError(refused), "Error: Picnic refused to hand out the order (HTTP 503)");
});

test('follows the cause, so the failure underneath is in the description too', () => {
  const refused = new Error("connect ECONNREFUSED 1.2.3.4:443");
  const failure = new Error("The order could not be retrieved");
  failure.cause = refused;

  assert.strictEqual(
    describeError(failure),
    "Error: The order could not be retrieved, caused by Error: connect ECONNREFUSED 1.2.3.4:443");
});

test('does not repeat the cause when the context already says what it was', () => {
  const parse = new SyntaxError("Unexpected token < in JSON at position 0");
  const wrapped = toError(parse, "The order info could not be read");

  assert.strictEqual(
    describeError(wrapped),
    "Error: The order info could not be read: SyntaxError: Unexpected token < in JSON at position 0");
});

test('describes values that were thrown without being an Error', () => {
  assert.strictEqual(describeError("Error: unauthorized"), "Error: unauthorized");
  assert.strictEqual(describeError(undefined), "undefined");
  assert.strictEqual(describeError(null), "null");
  assert.strictEqual(describeError(404), "404");
  assert.strictEqual(describeError({ error: "no delivery" }), '{"error":"no delivery"}');
});

test('describes a value that refers to itself rather than running out of stack', () => {
  const loop = { error: "broken" };
  loop.self = loop;

  assert.strictEqual(describeError(loop), '{"error":"broken","self":"[circular]"}');
});

test('describes a value mentioned twice without calling the second one circular', () => {
  const shared = { slot: "09:00" };

  assert.strictEqual(describeError({ first: shared, second: shared }), '{"first":{"slot":"09:00"},"second":{"slot":"09:00"}}');
  assert.strictEqual(describeError([shared, shared]), '[{"slot":"09:00"},{"slot":"09:00"}]');
});

test('still recognises a value nested inside itself', () => {
  const outer = { error: "broken" };
  outer.inner = { outer: outer };

  assert.strictEqual(describeError(outer), '{"error":"broken","inner":{"outer":"[circular]"}}');
});

test('recognises an Error from another realm, which instanceof does not', () => {
  const foreign = { name: "Error", message: "unauthorized" };

  assert.ok(isError(foreign));
  assert.strictEqual(describeError(foreign), "Error: unauthorized");
});

test('hands back the stack of an Error and says so when there is none', () => {
  assert.ok(describeStack(new Error("no route to host")).includes("errors.test.js"));
  assert.strictEqual(
    describeStack("Error: unauthorized"),
    "no stack trace, Error: unauthorized was thrown as a string");
});

test('turns anything that was thrown into an Error with a stack and the context', () => {
  const crash = toError("Error: an unexpected error occured.", "Unhandled rejection");

  assert.ok(crash instanceof Error);
  assert.strictEqual(crash.message, "Unhandled rejection: Error: an unexpected error occured.");
  assert.ok(crash.stack.includes("errors.test.js"));
});

test('keeps an Error as it is when it already says where it came from', () => {
  const failure = new Error("Polling Picnic: no route to host");

  assert.strictEqual(toError(failure, "Polling Picnic"), failure);
  assert.strictEqual(toError(failure), failure);
});

test('keeps the original stack under the context it was wrapped in', () => {
  const original = new Error("no route to host");
  const wrapped = toError(original, "Polling Picnic");

  assert.strictEqual(wrapped.cause, original);
  assert.ok(wrapped.stack.includes("Caused by: Error: no route to host"));
});

test('shortens an answer body to something a log line can carry', () => {
  assert.strictEqual(describeBody(""), "no answer body");
  assert.strictEqual(describeBody(undefined), "no answer body");
  assert.strictEqual(describeBody("  <html>\n  <body>no</body>\n"), "<html> <body>no</body>");
  assert.strictEqual(describeBody("x".repeat(500)), "x".repeat(200) + "...");
});
