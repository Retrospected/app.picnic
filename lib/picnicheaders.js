'use strict';

// The identification Picnic asked this app to send on every call to their
// backend, so they can tell this app's traffic apart in their own logs:
// https://github.com/Retrospected/app.picnic/issues/17
//
// It lives here because it belongs on all of them, and because the value is
// not settled: Picnic asked for client id 10100 with a version of this app,
// that combination stopped being accepted in 2022, and #40 replaced it with a
// pinned version of Picnic's own Android app. Changing it back needs a value
// Picnic confirms, and this is the one line to change when they do.
//
// The version in it is not a label: Picnic works out the cart for the app
// version a client says it is. Pinned at 1.15.233 the cart came back without
// the promotions that version predates, BundelBonus among them, and with the
// Family discount folded into the line prices, so its total_price was up to
// tens of cents above what Picnic's app shows for the same cart. 1.236.1 is
// what the maintained TypeScript client sends, and gave the same total, the
// same discounts and the same Family discount (membership_savings) as the
// Picnic app on a real cart. When the totals drift apart again, this is the
// first thing to move forward.
const PICNIC_AGENT = "30100;1.236.1-15553;";
const PICNIC_DID = "open.app.picnic.homey";

module.exports = { PICNIC_AGENT, PICNIC_DID };
