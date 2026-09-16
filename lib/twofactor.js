'use strict';

// Picnic sends its second factor over SMS, so a code costs the user a text
// message. The app never asks for one by itself: it only does so for a sign-in
// someone started on the settings page, where they are waiting for the code.
// What is left to decide is when a login is waiting on the user rather than on
// anything the app could do, which is kept here, free of Homey APIs, so it can
// be reasoned about and unit tested on its own.

/**
 * Whether a second factor stands between the app and a usable session.
 *
 * @param {Object} state the stored 2FA state, as { pendingToken, pendingFlag, codeRequestedAt }
 * @returns {boolean} true while a login is unfinished for want of a code
 */
function verificationPending(state) {
  if (!state) return false;

  return !!state.pendingToken || state.pendingFlag === true;
}

/**
 * Whether the app is waiting on a code Picnic actually sent.
 *
 * Logging in again would replace the session that code belongs to, which is
 * what makes it verify, so the poll stays put for as long as this holds. A
 * login left half finished is deliberately not this: with no code on its way
 * to anyone, waiting for one would be waiting forever.
 *
 * @param {Object} state the stored 2FA state, as { pendingToken, pendingFlag, codeRequestedAt }
 * @returns {boolean} true while a code is out there waiting to be typed in
 */
function awaitingVerification(state) {
  if (!verificationPending(state)) return false;

  // A code is verified against the token the login it came from handed out.
  // Without that token there is nothing to verify against, so whatever was
  // sent is useless and a new sign-in is the way out rather than a wait.
  if (!state.pendingToken) return false;

  // A moment that cannot be read counts as no code at all: the app can wait
  // for a text message, it cannot conjure up one that was never sent.
  const requestedAt = Number(state.codeRequestedAt);

  return Number.isFinite(requestedAt) && requestedAt > 0;
}

module.exports = { verificationPending, awaitingVerification };
