'use strict';

// What Picnic refusing a request means for the app. Kept free of Homey APIs so
// it can be unit tested on its own, like the rest of the decision logic here.

const { describeBody } = require('./errors.js');

// the code that marks the one failure the poll reacts to by logging in again
const UNAUTHORIZED = 'PICNIC_UNAUTHORIZED'

// The token was accepted, but Picnic wants its second factor verified before
// it hands anything out. Logging in again cannot fix that: only the person
// holding the phone the code goes to can, so this is told apart from the above.
const SECOND_FACTOR_REQUIRED = 'PICNIC_SECOND_FACTOR_REQUIRED'

// How Picnic names that refusal in the body of its HTTP 403.
const PICNIC_SECOND_FACTOR_CODE = 'TWO_FACTOR_AUTHENTICATION_REQUIRED'

// The code Picnic puts in the body of a refusal, as in
// {"error":{"code":"TWO_FACTOR_AUTHENTICATION_REQUIRED",...}}, or null.
function picnicErrorCode(body) {
  try {
    const parsed = typeof body == 'string' ? JSON.parse(body) : body;
    const code = parsed && parsed["error"] && parsed["error"]["code"];
    return typeof code == 'string' && code != "" ? code : null;
  } catch (exception) {
    return null;
  }
}

/**
 * The failure a response amounts to, or null when it is not one.
 *
 * @param {number} statusCode the HTTP status Picnic answered with
 * @param {string} body the response body
 * @param {string} subject what was asked for, as in "the order"
 * @returns {Error|null}
 */
function refusal(statusCode, body, subject) {
  if (statusCode >= 200 && statusCode < 300) return null;

  if (picnicErrorCode(body) == PICNIC_SECOND_FACTOR_CODE) {
    const secondFactor = new Error("Picnic wants a 2FA code before it hands out " + subject);
    secondFactor.statusCode = statusCode;
    secondFactor.code = SECOND_FACTOR_REQUIRED;
    return secondFactor;
  }

  if (statusCode == 401) {
    // still reads as "Error: unauthorized" for the poll to compare against;
    // the properties are what tell it apart in a report
    const unauthorized = new Error("unauthorized");
    unauthorized.statusCode = statusCode;
    unauthorized.code = UNAUTHORIZED;
    return unauthorized;
  }

  // a refusal used to be read as order info and fail as a parse error
  const refused = new Error("Picnic refused to hand out " + subject + ": " + describeBody(body));
  refused.statusCode = statusCode;
  return refused;
}

// Whether a failure, possibly wrapped, carries the given code.
function hasCode(error, code) {
  for (let value = error, depth = 0; value !== undefined && value !== null && depth < 10; depth++) {
    if (typeof value !== 'object') return false;
    if (value.code === code) return true;
    value = value.cause;
  }

  return false;
}

module.exports = { UNAUTHORIZED, SECOND_FACTOR_REQUIRED, picnicErrorCode, refusal, hasCode };
