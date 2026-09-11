'use strict';

// The identification Picnic asked this app to send on every call to their
// backend, so they can tell this app's traffic apart in their own logs:
// https://github.com/Retrospected/app.picnic/issues/17
//
// It lives here because it belongs on all of them, and because the value is
// not settled: Picnic asked for client id 10100 with a version of this app,
// that combination stopped being accepted in 2022, and #40 replaced it with
// the identity below. Changing it back needs a value Picnic confirms, and
// this is the one line to change when they do.
const PICNIC_AGENT = "30100;1.15.233-#15158";
const PICNIC_DID = "open.app.picnic.homey";

module.exports = { PICNIC_AGENT, PICNIC_DID };
