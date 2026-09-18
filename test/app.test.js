// Boots the real app.js against a stub of Homey and of Picnic, to test what
// only shows when the pieces are put together: what the widget is told after
// Picnic's answers have been through the poll, the settings and the state.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Module = require('module');

// app.js asks for 'homey', which only exists inside Homey
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'homey') return path.join(__dirname, 'support', 'homey.js');
  return resolve.call(this, request, ...rest);
};

const Picnic = require('../app.js');

const MINUTE = 60 * 1000;

function iso(offset) {
  return new Date(Date.now() + offset).toISOString();
}

// Lets the promises the app starts without awaiting run their course.
function settle() {
  return new Promise(resolve => setTimeout(resolve, 20));
}

function trigger() {
  return { registerRunListener() { return this; }, on() { }, trigger: async () => { }, getArgumentValues: async () => [] };
}

function card() {
  return { registerRunListener() { return card(); }, registerAutocompleteListener() { return card(); }, getArgument() { return card(); } };
}

// An app that last heard about yesterday's delivery, signed in, with Picnic
// answering whatever the test says it answers.
async function boot(picnic) {
  const settings = {
    "country": "nl",
    "url": "storefront-prod.nl.picnicinternational.com",
    "username": "someone",
    "password": "secret",
    "order_status": "groceries_delivered",
    "delivery_eta_start": iso(-24 * 60 * MINUTE),
    "delivery_eta_end": iso(-23 * 60 * MINUTE),
    "delivery_time": iso(-23 * 60 * MINUTE),
    "order_price": 46.8
  };

  const homey = {
    log() { },
    error() { },
    manifest: { version: "test" },
    settings: {
      get: key => (key in settings ? settings[key] : null),
      set: (key, value) => { settings[key] = value; },
      unset: key => { delete settings[key]; },
      getKeys: () => Object.keys(settings)
    },
    clock: { getTimezone: () => "Europe/Amsterdam" },
    i18n: { getLanguage: () => "nl" },
    __: key => key,
    flow: {
      createToken: async () => ({ setValue: async () => { } }),
      getTriggerCard: () => trigger(),
      getConditionCard: () => card(),
      getActionCard: () => card()
    },
    api: { realtime: async () => { } },
    notifications: { createNotification: async () => { } }
  };

  const app = new Picnic();
  app.homey = homey;
  homey.app = app;

  // booted without a token, so the poll it starts with does not go out to
  // the real Picnic before its stand-in is in place
  app.onInit();

  app.utils.getOrderStatus = async () => JSON.stringify(picnic.summary());
  app.utils.getCart = async () => JSON.stringify(picnic.cart());
  app.utils.getDelivery = async () => JSON.stringify({});
  // no van assigned yet: Picnic answers with nothing
  app.utils.getDeliveryPosition = async () => "";

  // signed in, and the poll the app starts with
  settings["x-picnic-auth"] = "token";
  await app.pollOrder();
  await settle();

  return { app, settings };
}

async function stop(app) {
  await app.onUninit();
  app._removeFailureHandlers();
}

// What Picnic answers once an order is placed for tomorrow morning, with
// twenty minutes left to add to it.
function placedOrder() {
  return [{
    delivery_id: "d2",
    status: "CURRENT",
    slot: {
      window_start: iso(20 * 60 * MINUTE),
      window_end: iso(21 * 60 * MINUTE),
      cut_off_time: iso(20 * MINUTE)
    },
    orders: [{ total_price: 4512 }]
  }];
}

function emptyCart() {
  return { total_price: 0, checkout_total_price: 0, total_count: 0, items: [] };
}

test('an order placed in the Picnic app between polls reaches the widget with its deadline', async () => {
  var summary = [];
  const { app, settings } = await boot({ summary: () => summary, cart: emptyCart });

  // what the dashboard showed before: yesterday's delivery done, nothing since
  assert.strictEqual((await app.getDeliveryWidgetState()).state, "empty");

  // an order is placed in the Picnic app, and the last poll was a while ago
  summary = placedOrder();
  settings["order_checked_at"] = iso(-10 * MINUTE);

  await app.getDeliveryWidgetState();
  await settle();
  const state = await app.getDeliveryWidgetState();

  try {
    assert.strictEqual(settings["order_status"], "groceries_ordered");
    assert.strictEqual(state.state, "ordered");
    assert.strictEqual(state.price, 45.12);
    // the deadline to add to the order is carried along, twenty minutes out
    const left = Date.parse(state.cutOffAt) - Date.now();
    assert.ok(left > 15 * MINUTE && left <= 20 * MINUTE, "expected the cut off about twenty minutes out, got " + state.cutOffAt);
  } finally {
    await stop(app);
  }
});

test('a cart that was just emptied has Picnic asked about orders right away', async () => {
  var summary = [];
  var cart = { total_price: 3286, checkout_total_price: 3286, total_count: 18, items: [] };
  const { app, settings } = await boot({ summary: () => summary, cart: () => cart });

  // the widget sees the full cart
  await app.getDeliveryWidgetState();
  await settle();
  assert.strictEqual((await app.getDeliveryWidgetState()).state, "cart");

  // it is checked out: the cart empties and an order appears, while the last
  // poll is recent enough not to be due by itself
  cart = emptyCart();
  summary = placedOrder();
  settings["order_checked_at"] = iso(-1 * MINUTE);
  app._cart["refreshedAt"] = 0;

  await app.getDeliveryWidgetState();
  await settle();

  try {
    assert.strictEqual((await app.getDeliveryWidgetState()).state, "ordered");
  } finally {
    await stop(app);
  }
});

test('Picnic is not asked about orders again within five minutes', async () => {
  var asked = 0;
  const { app, settings } = await boot({ summary: () => { asked++; return []; }, cart: emptyCart });

  settings["order_checked_at"] = iso(-1 * MINUTE);
  const before = asked;

  await app.getDeliveryWidgetState();
  await settle();
  await app.getDeliveryWidgetState();
  await settle();

  try {
    assert.strictEqual(asked, before);
  } finally {
    await stop(app);
  }
});
