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

// How long a code Picnic sent is worth typing in. Picnic decides this, not the
// app: this is only what the settings page goes by when it offers the field to
// type a code into, so that it stops offering one for a code that has died of
// old age. Nothing is sent or thrown away on the strength of it.
const CODE_VALIDITY = 1000 * 60 * 5; // 5 minutes

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

/**
 * Whether there is a code worth typing in.
 *
 * Deliberately not the same question as awaitingVerification, which stays true
 * however old the code is: the poll holds off for as long as a half finished
 * login is stored, because only the user can replace it and the app must not
 * go behind their back to do so. This one is what the settings page asks, and
 * a code Picnic has long since expired is not worth a field to type it into.
 *
 * @param {Object} state the stored 2FA state, as { pendingToken, pendingFlag, codeRequestedAt }
 * @param {number} now the moment the page is being looked at, in milliseconds since the epoch
 * @returns {boolean} true while the code that was sent can still be used
 */
function codeIsUsable(state, now) {
  if (!awaitingVerification(state)) return false;

  const age = now - Number(state.codeRequestedAt);

  // a clock that moved backwards is no reason to call a fresh code expired
  if (age < 0) return true;

  return age < CODE_VALIDITY;
}

module.exports = { verificationPending, awaitingVerification, codeIsUsable, CODE_VALIDITY };
