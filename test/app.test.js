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
  app.utils.getDelivery = async () => JSON.stringify(picnic.delivery ? picnic.delivery() : {});
  // nothing paid yet, unless the test says so
  app.utils.getWalletTransactions = async () => JSON.stringify(picnic.payments ? picnic.payments().map(payment => ({ id: payment.id, amount_in_cents: payment.amount_in_cents })) : []);
  app.utils.getWalletTransaction = async id => JSON.stringify((picnic.payments ? picnic.payments() : []).find(payment => payment.id == id) || {});
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

// Groceries that came ten minutes ago: 53,43 on the order, a can and a bag
// handed back to the driver.
function justDelivered(settings) {
  settings["delivery_id"] = "d1";
  settings["delivery_eta_start"] = iso(-20 * MINUTE);
  settings["delivery_eta_end"] = iso(0);
  settings["delivery_time"] = iso(-10 * MINUTE);
}

function deliveredOrder() {
  return {
    delivery_id: "d1",
    delivery_time: { start: iso(-10 * MINUTE), end: iso(-9 * MINUTE) },
    orders: [{ checkout_total_price: 5343, total_deposit: 15 }],
    returned_containers: [
      { type: "CAN", localized_name: "1 x blikje", quantity: 1, price: 15 },
      { type: "BAG", localized_name: "Tasjes", quantity: 1, price: 39 }
    ]
  };
}

test('a delivery comes to what was ordered less the deposit that went back, until Picnic has settled it', async () => {
  const { app, settings } = await boot({ summary: () => [], cart: emptyCart, delivery: deliveredOrder });
  justDelivered(settings);

  await app.getDeliveryWidgetState();
  await settle();
  const state = await app.getDeliveryWidgetState();

  try {
    assert.strictEqual(state.state, "delivered");
    assert.strictEqual(state.price, 52.89);
    assert.deepStrictEqual(state.deposit.containers, [{ name: "blikje", quantity: 1 }, { name: "Tasjes", quantity: 1 }]);
  } finally {
    await stop(app);
  }
});

test('a settled delivery comes to what was taken from the account, refunds and all', async () => {
  const payments = [
    // the newest payment is for something else, the one after it for this delivery
    { id: "t3", amount_in_cents: -1250, delivery_id: "d9", transaction_status: "SUCCEEDED" },
    { id: "t2", amount_in_cents: -5189, delivery_id: "d1", transaction_status: "SUCCEEDED" }
  ];
  const { app, settings } = await boot({ summary: () => [], cart: emptyCart, delivery: deliveredOrder, payments: () => payments });
  justDelivered(settings);

  await app.getDeliveryWidgetState();
  await settle();
  const state = await app.getDeliveryWidgetState();

  try {
    assert.strictEqual(state.price, 51.89);
    assert.strictEqual(app._charge.transactionId, "t2");
  } finally {
    await stop(app);
  }
});

test('the wallet is not asked about an order that has not been delivered', async () => {
  var asked = 0;
  const { app } = await boot({ summary: placedOrder, cart: emptyCart, payments: () => { asked++; return []; } });

  await app.getDeliveryWidgetState();
  await settle();

  try {
    assert.strictEqual(asked, 0);
  } finally {
    await stop(app);
  }
});

test('a widget asking for it fresh has the cart fetched once it is half a minute old, and gets it in the answer', async () => {
  var cart = emptyCart();
  var asked = 0;
  const { app } = await boot({ summary: () => [], cart: () => { asked++; return cart; } });

  // what the widget last saw: an empty cart, fetched a minute ago
  await app.getDeliveryWidgetState();
  await settle();
  app._cart["refreshedAt"] = Date.now() - 60 * 1000;
  const before = asked;

  // then the cart is filled in Picnic's app
  cart = { total_price: 3286, checkout_total_price: 3286, total_count: 18, items: [] };

  try {
    // five minutes have not passed, so an ordinary answer does not ask
    assert.strictEqual((await app.getDeliveryWidgetState()).state, "empty");
    assert.strictEqual(asked, before);

    // a fresh one does, and waits for it
    assert.strictEqual((await app.refreshDeliveryWidgetState()).state, "cart");
    assert.strictEqual(asked, before + 1);

    // and within half a minute of that, Picnic is left alone however often
    // it is asked for fresh
    await app.refreshDeliveryWidgetState();
    await app.refreshDeliveryWidgetState();
    assert.strictEqual(asked, before + 1);
  } finally {
    await stop(app);
  }
});

test('a widget asking for it fresh has orders asked about once they are half a minute old', async () => {
  var asked = 0;
  const { app, settings } = await boot({ summary: () => { asked++; return []; }, cart: emptyCart });

  settings["order_checked_at"] = new Date(Date.now() - 60 * 1000).toISOString();
  const before = asked;

  try {
    await app.refreshDeliveryWidgetState();
    assert.strictEqual(asked, before + 1);
  } finally {
    await stop(app);
  }
});
