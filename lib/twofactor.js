'use strict';

// Picnic sends its second factor over SMS, so asking for a code costs the user
// a text message. The decisions about when that is worth doing are kept here,
// free of Homey APIs, so they can be reasoned about and unit tested on their own.

// How long a code Picnic already sent counts as still usable. A login inside
// this window reuses it instead of having another SMS sent.
const CODE_COOLDOWN = 1000 * 60 * 10; // 10 minutes

/**
 * Whether a code Picnic sent is still waiting for someone to type it in.
 *
 * Only the person holding the phone can finish such a login, so this is the
 * one state the app cannot get itself out of by trying again.
 *
 * @param {Object} state the stored 2FA state, as { pendingToken, pendingFlag, codeRequestedAt }
 * @returns {boolean} true while a verification is outstanding
 */
function verificationPending(state) {
  if (!state) return false;

  return !!state.pendingToken || state.pendingFlag === true;
}

/**
 * Whether the app is waiting on a code Picnic actually sent.
 *
 * This is the one state trying again cannot get the app out of, so it is what
 * the poll stops at. A login that was left half finished is deliberately not
 * this: with no code on its way to anyone, waiting would be waiting forever.
 *
 * @param {Object} state the stored 2FA state, as { pendingToken, pendingFlag, codeRequestedAt }
 * @returns {boolean} true while a code is out there waiting to be typed in
 */
function awaitingVerification(state) {
  if (!verificationPending(state)) return false;

  // A code is verified against the token the login it came from handed out.
  // Without that token there is nothing to verify against, so whatever was
  // sent is useless and another login is the way out rather than a wait.
  if (!state.pendingToken) return false;

  return codeSentAt(state) !== null;
}

/**
 * Whether a login that needs a second factor should have Picnic send a code.
 *
 * @param {Object} state the stored 2FA state, as { pendingToken, pendingFlag, codeRequestedAt }
 * @param {number} now the moment of this login, in milliseconds since the epoch
 * @returns {boolean} true when a new code is worth an SMS
 */
function shouldRequestCode(state, now) {
  if (!awaitingVerification(state)) return true;

  const requestedAt = codeSentAt(state);

  // a clock that moved backwards should not lock anyone out of a code
  if (now < requestedAt) return true;

  return now - requestedAt >= CODE_COOLDOWN;
}

// When the code was sent, or null when no code is known to have been sent at
// all. A moment that cannot be read counts as no code: the app can send one,
// it cannot conjure up the text message a user never got.
function codeSentAt(state) {
  const requestedAt = Number(state.codeRequestedAt);

  if (!Number.isFinite(requestedAt) || requestedAt <= 0) return null;

  return requestedAt;
}

module.exports = { verificationPending, awaitingVerification, shouldRequestCode, CODE_COOLDOWN };
