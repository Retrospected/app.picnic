// Drives the widget's own script against a stub of the little bit of browser
// it uses, so the states it can end up in are seen rendered rather than read.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert');
const test = require('node:test');

const { deriveDeliveryState } = require('../lib/deliverystate.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'widgets', 'delivery', 'public', 'index.html'), 'utf8');
const script = html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];

// the English labels the app hands over, straight from the locale file
const LABELS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', 'en.json'), 'utf8')).widget.delivery;

const NODES = ['tile', 'badge', 'badge-icon', 'status-pill', 'status-icon', 'status', 'meta', 'caption', 'headline', 'value', 'unit', 'detail', 'when-short', 'when', 'what', 'track', 'fill', 'note', 'note-first', 'note-second', 'note-short-lines', 'note-short', 'note-short-second'];

// The note as a full width tile shows it, its two lines joined by " / ", and as
// a half width one does.
function noteOf(nodes) {
  return [nodes['note-first'].textContent, nodes['note-second'].hidden ? '' : nodes['note-second'].textContent].filter(Boolean).join(' / ');
}

function shortNoteOf(nodes) {
  return [nodes['note-short'].textContent, nodes['note-short-second'].hidden ? '' : nodes['note-short-second'].textContent].filter(Boolean).join(' / ');
}

function harness(settings) {
  const nodes = {};

  NODES.forEach(id => {
    nodes[id] = {
      textContent: '',
      hidden: false,
      dataset: {},
      style: {},
      attributes: {},
      clientWidth: 0,
      scrollWidth: 0,
      setAttribute(name, value) { this.attributes[name] = value; },
      listeners: {},
      addEventListener(type, listener) { this.listeners[type] = listener; }
    };
  });

  // what the widget asked the app, and what the page is listening for
  const calls = [];
  const page = { hidden: false, listeners: {} };
  // what the stand-in Homey buzzed
  const buzzes = [];

  const context = {
    document: {
      getElementById: id => nodes[id],
      get hidden() { return page.hidden; },
      addEventListener(type, listener) { page.listeners[type] = listener; }
    },
    console: { error() { } },
    Intl,
    Date,
    Promise,
    Object,
    setTimeout() { },
    setInterval() { },
    isNaN,
    isFinite,
    String,
    Math,
    JSON
  };

  vm.createContext(context);
  vm.runInContext(script, context);

  context.onHomeyReady({
    ready() { },
    on() { },
    getSettings: () => settings || {},
    api: (method, route) => { calls.push(method + ' ' + route); return Promise.resolve(null); },
    hapticFeedback: () => { buzzes.push(true); }
  });

  return {
    nodes,
    calls,
    page,
    buzzes,
    adopt: context.adopt,
    render: context.render,
    // the caption above the number reads as part of it: "Delivery in" "15 min"
    headline: () => [nodes.caption, nodes.value, nodes.unit].filter(node => !node.hidden && node.textContent).map(node => node.textContent).join(' '),
    detail: () => [nodes.when.textContent, nodes.what.textContent].filter(Boolean).join(' · ')
  };
}

// What the app hands the widget, with its formatting stood in for: the times
// and days are Homey's business and tested where they are made.
function payload(stored, extra) {
  const derived = deriveDeliveryState(Object.assign({ checkedAt: stored.now }, stored));
  const cart = derived.cart;

  return Object.assign({
    state: derived.state,
    now: stored.now,
    countdownTo: derived.countdownTo,
    progress: derived.progress,
    day: derived.etaStart || derived.deliveredAt ? 'today' : '',
    window: derived.etaStart ? '16:11–16:31' : '',
    windowEnd: derived.etaEnd,
    position: stored.position || null,
    deliveredTime: derived.deliveredAt ? '16:18' : '',
    cutOffAt: derived.cutOffAt,
    cutOffLabel: derived.cutOffAt ? 'today 23:00' : '',
    price: ['ordered', 'announced', 'underway', 'arriving', 'overdue', 'delivered'].indexOf(derived.state) != -1 ? 52.5 : null,
    deposit: derived.delivery ? {
      returned: derived.delivery.depositReturned,
      containers: derived.delivery.returned.map(container => ({ name: container.name, quantity: container.quantity }))
    } : null,
    cart: cart ? {
      totalPrice: cart.totalPrice,
      productCount: cart.productCount,
      minimumShort: cart.minimumShort,
      slotChosen: cart.slotChosen,
      slotClosed: cart.slotClosed,
      slot: cart.slot ? {
        day: 'Sat 20 Sep',
        window: '18:15–19:15',
        cutOffAt: cart.slot.cutOffAt,
        cutOffTime: cart.slot.cutOffAt ? '23:00' : '',
        cutOffDay: cart.slot.cutOffAt ? 'Fri 19 Sep' : '',
        cutOffLabel: cart.slot.cutOffAt ? 'Fri 19 Sep 23:00' : ''
      } : null
    } : null,
    cartKnown: derived.cartKnown,
    chosenSlot: derived.chosenSlot ? {
      day: 'tomorrow',
      window: '14:30–15:30',
      cutOffAt: derived.chosenSlot.cutOffAt,
      cutOffTime: '23:00',
      cutOffDay: 'today',
      cutOffLabel: 'today 23:00'
    } : null,
    nextSlots: derived.nextSlots ? { day: 'tomorrow', time: '08:30', window: derived.nextSlots.windowEnd ? '08:30–09:30' : '08:30', available: derived.nextSlots.available, total: derived.nextSlots.total } : null,
    checkedLabel: derived.checkedAt ? 'Sun 5 Apr 08:00' : '',
    locale: 'en-US',
    labels: LABELS
  }, extra);
}

const WINDOW = { etaStart: '2026-07-28T16:11:00.000+02:00', etaEnd: '2026-07-28T16:31:00.000+02:00' };

// the next day with an open slot, as the cart lists it
const NEXT = { windowStart: '2026-07-29T08:30:00.000+02:00', windowEnd: '2026-07-29T09:30:00.000+02:00', available: 3, total: 12 };
const ANNOUNCED = Object.assign({ orderStatus: 'delivery_announced', announcedAt: '2026-07-28T15:41:00.000+02:00' }, WINDOW);

// and the van on the road towards that window, since 15:41
const UNDERWAY = Object.assign({ position: { inProgress: true, etaStart: WINDOW.etaStart, etaEnd: WINDOW.etaEnd }, underwayAt: '2026-07-28T15:41:00.000+02:00' }, ANNOUNCED);

function cart(extra) {
  return Object.assign({
    totalPrice: 22.03,
    productCount: 9,
    minimumOrderValue: 15,
    slot: { chosen: true, windowStart: '2026-07-30T18:15:00.000+02:00', windowEnd: '2026-07-30T19:15:00.000+02:00', cutOffAt: '2026-07-29T23:00:00.000+02:00' }
  }, extra);
}

test('a van on the road counts the minutes down and fills the bar towards the end of its window', () => {
  const { nodes, adopt, headline, detail } = harness();

  adopt(payload(Object.assign({ now: '2026-07-28T15:56:00.000+02:00' }, UNDERWAY)));

  assert.strictEqual(nodes.tile.dataset.tone, 'calm');
  assert.strictEqual(nodes.badge.dataset.icon, 'truck');
  assert.strictEqual(nodes.status.textContent, 'On its way');
  assert.strictEqual(headline(), 'Delivery in 15 min');
  assert.strictEqual(detail(), 'today 16:11–16:31');
  assert.strictEqual(nodes.track.hidden, false);
  // 15 of the 50 minutes from the van leaving at 15:41 to the end of the window
  assert.strictEqual(nodes.fill.style.width, '30%');
  assert.strictEqual(nodes.meta.textContent, '€52.50');
});

test('an order days out counts in days and shows no bar', () => {
  const { nodes, adopt, headline } = harness();

  adopt(payload({
    orderStatus: 'groceries_ordered',
    etaStart: '2026-07-30T16:00:00.000+02:00',
    etaEnd: '2026-07-30T17:00:00.000+02:00',
    now: '2026-07-28T16:00:00.000+02:00'
  }));

  assert.strictEqual(nodes.status.textContent, 'Pending order');
  assert.strictEqual(nodes.tile.dataset.tone, 'calm');
  assert.strictEqual(nodes.badge.dataset.icon, 'scheduled');
  assert.strictEqual(headline(), 'Delivery in 2 days');
  assert.strictEqual(nodes.track.hidden, true);
});

test('a single minute left is not pluralised', () => {
  const { adopt, headline } = harness();

  adopt(payload(Object.assign({ now: '2026-07-28T16:10:30.000+02:00' }, ANNOUNCED)));

  assert.strictEqual(headline(), 'Delivery in 1 min');
});

test('the window itself says the groceries are arriving, with the bar most of the way', () => {
  const { nodes, adopt, headline } = harness();

  adopt(payload(Object.assign({ now: '2026-07-28T16:16:00.000+02:00' }, UNDERWAY)));

  assert.strictEqual(nodes.status.textContent, 'Almost there');
  assert.strictEqual(headline(), 'Any minute now');
  // 35 of the 50 minutes from the van leaving to the end of the window: the
  // bar goes on from where it was at 16:11, rather than starting over there
  assert.strictEqual(nodes.fill.style.width, '70%');
});

test('a delivery that is late says so in its own colour', () => {
  const { nodes, adopt, headline } = harness();

  adopt(payload(Object.assign({ now: '2026-07-28T17:00:00.000+02:00' }, ANNOUNCED)));

  assert.strictEqual(nodes.status.textContent, 'Running late');
  assert.strictEqual(nodes.tile.dataset.tone, 'warn');
  assert.strictEqual(headline(), 'Any minute now');
  assert.strictEqual(nodes.fill.style.width, '100%');
  // and how late, which is the question the word raises
  assert.strictEqual(noteOf(nodes), '29 minutes past the announced window');
  assert.strictEqual(shortNoteOf(nodes), '29 min late');
  assert.strictEqual(nodes.note.dataset.tone, 'warn');
});

test('delivered groceries show the moment they arrived and what they cost', () => {
  const { nodes, adopt, headline, detail } = harness();

  adopt(payload(Object.assign({ orderStatus: 'groceries_delivered', deliveredAt: '2026-07-28T16:18:00.000+02:00', now: '2026-07-28T16:40:00.000+02:00' }, WINDOW)));

  assert.strictEqual(nodes.status.textContent, 'Delivered');
  assert.strictEqual(nodes.tile.dataset.tone, 'good');
  // the badge already says delivered, so the caption says when
  assert.strictEqual(headline(), 'today at 16:18');
  assert.strictEqual(detail(), '');
  assert.strictEqual(nodes.meta.textContent, '€52.50');
  assert.strictEqual(nodes.note.hidden, true);
});

test('deposit that came back is shown with the delivery', () => {
  const { nodes, adopt, detail } = harness();

  adopt(payload(Object.assign({
    orderStatus: 'groceries_delivered',
    deliveredAt: '2026-07-28T16:18:00.000+02:00',
    delivery: { deliveredAt: '2026-07-28T16:18:00.000+02:00', totalPrice: 22.03, depositReturned: 4.8, returned: [{ name: 'Bottles', quantity: 6, amount: 0.9 }, { name: 'Crates', quantity: 1, amount: 3.9 }] },
    now: '2026-07-28T16:40:00.000+02:00'
  }, WINDOW)));

  assert.strictEqual(detail(), '6× Bottles, 1× Crates');
  assert.strictEqual(noteOf(nodes), '+€4.80 deposit back');
  assert.strictEqual(nodes.note.dataset.tone, 'good');
});

test('four hours after the delivery the widget has moved on', () => {
  const { nodes, adopt, headline, detail } = harness();

  adopt(payload(Object.assign({ orderStatus: 'groceries_delivered', deliveredAt: '2026-07-28T12:00:00.000+02:00', now: '2026-07-28T16:01:00.000+02:00' }, WINDOW), { cartKnown: true }));

  assert.strictEqual(nodes.status.textContent, '');
  assert.strictEqual(headline(), 'No pending order');
  assert.strictEqual(detail(), 'Your cart is empty');
  assert.strictEqual(nodes.meta.textContent, '');
});

test('nothing planned and nothing known about the cart says only the first', () => {
  const { adopt, detail, nodes } = harness();

  adopt(payload({ orderStatus: '', now: '2026-07-28T16:40:00.000+02:00' }));

  assert.strictEqual(detail(), '');
  assert.strictEqual(nodes.detail.hidden, true);
  assert.strictEqual(nodes.tile.dataset.tone, 'muted');
});

test('an app that cannot reach Picnic asks for a sign in', () => {
  const { adopt, headline, nodes } = harness();

  adopt(payload(Object.assign({ signInNeeded: true, now: '2026-07-28T16:40:00.000+02:00' }, ANNOUNCED)));

  assert.strictEqual(headline(), 'Sign in again');
  assert.strictEqual(nodes.badge.dataset.icon, 'alert');
});

test('an order Picnic has not confirmed in months is not retold as late', () => {
  const { nodes, adopt, headline, detail } = harness();

  adopt(payload(Object.assign({}, ANNOUNCED, {
    etaStart: '2026-04-05T09:04:00.000+02:00',
    etaEnd: '2026-04-05T09:24:00.000+02:00',
    checkedAt: '2026-04-05T08:00:00.000+02:00',
    now: '2026-09-17T11:42:00.000+02:00'
  })));

  assert.strictEqual(headline(), 'No recent word from Picnic');
  assert.strictEqual(detail(), 'Last updated Sun 5 Apr 08:00');
  assert.strictEqual(nodes.meta.textContent, '');
  assert.strictEqual(nodes.track.hidden, true);
});

test('amounts can be turned off', () => {
  const { nodes, adopt, headline } = harness({ show_price: false });

  adopt(payload(Object.assign({ now: '2026-07-28T15:56:00.000+02:00' }, ANNOUNCED)));
  assert.strictEqual(nodes.meta.textContent, '');

  const cartOnly = harness({ show_price: false });
  cartOnly.adopt(payload({ orderStatus: '', cart: cart({ slot: null }), now: '2026-07-28T10:00:00.000+02:00' }));
  assert.strictEqual(cartOnly.headline(), 'Pick a delivery slot');
  assert.strictEqual(cartOnly.nodes.meta.textContent, '9 products');

  // and a cart with a slot keeps its deadline, just not the amount next to
  // it, nor what it is short of the minimum, which is an amount too
  const deadline = harness({ show_price: false });
  deadline.adopt(payload({ orderStatus: '', cart: cart({ minimumOrderValue: 45 }), now: '2026-07-28T10:00:00.000+02:00' }));
  assert.strictEqual(deadline.headline(), 'Order before 23:00 Fri 19 Sep');
  assert.strictEqual(deadline.detail(), 'Sat 20 Sep 18:15–19:15');
  assert.strictEqual(deadline.nodes.meta.textContent, '9 products');
  assert.strictEqual(deadline.nodes.note.hidden, true);
});

test('a clock that runs ahead of Homey does not count down to the wrong minute', () => {
  const { adopt, headline } = harness();
  const realNow = Date.now;
  // the dashboard is showing on something four minutes fast
  Date.now = () => realNow() + 4 * 60 * 1000;

  try {
    adopt(payload(Object.assign({ now: '2026-07-28T15:56:00.000+02:00' }, ANNOUNCED)));

    assert.strictEqual(headline(), 'Delivery in 15 min');
  } finally {
    Date.now = realNow;
  }
});

test('an order that can still be added to says until when', () => {
  const { nodes, adopt } = harness();

  adopt(payload({
    orderStatus: 'groceries_ordered',
    etaStart: '2026-07-28T16:00:00.000+02:00',
    etaEnd: '2026-07-28T17:00:00.000+02:00',
    cutOffAt: '2026-07-28T14:00:00.000+02:00',
    now: '2026-07-28T10:00:00.000+02:00'
  }));

  assert.strictEqual(nodes.note.hidden, false);
  assert.strictEqual(noteOf(nodes), 'Can be added to until today 23:00');
  assert.strictEqual(nodes.note.dataset.tone, '');
});

test('the last hour before an order closes is counted down and called out', () => {
  const { nodes, adopt } = harness();

  adopt(payload({
    orderStatus: 'groceries_ordered',
    etaStart: '2026-07-28T16:00:00.000+02:00',
    etaEnd: '2026-07-28T17:00:00.000+02:00',
    cutOffAt: '2026-07-28T14:00:00.000+02:00',
    now: '2026-07-28T13:35:00.000+02:00'
  }));

  assert.strictEqual(noteOf(nodes), '25 minutes left to add to it');
  assert.strictEqual(nodes.note.dataset.tone, 'warn');
});

test('a cut off that has passed has nothing left to say', () => {
  const { nodes, adopt } = harness();

  adopt(payload({
    orderStatus: 'groceries_ordered',
    etaStart: '2026-07-28T16:00:00.000+02:00',
    etaEnd: '2026-07-28T17:00:00.000+02:00',
    cutOffAt: '2026-07-28T14:00:00.000+02:00',
    now: '2026-07-28T14:30:00.000+02:00'
  }));

  assert.strictEqual(nodes.note.hidden, true);
  assert.strictEqual(noteOf(nodes), '');
});

test('a cart while an order is open is what still has to go onto that order', () => {
  const { nodes, adopt, headline } = harness();

  adopt(payload({
    orderStatus: 'groceries_ordered',
    etaStart: '2026-07-28T16:00:00.000+02:00',
    etaEnd: '2026-07-28T17:00:00.000+02:00',
    cutOffAt: '2026-07-27T23:00:00.000+02:00',
    cart: cart({ totalPrice: 12.4, productCount: 3 }),
    now: '2026-07-27T19:00:00.000+02:00'
  }));

  // the delivery is still the headline, the things not on it yet the note
  assert.strictEqual(headline(), 'Delivery in 21 hours');
  assert.strictEqual(noteOf(nodes), '3 more products in your cart / Can be added until today 23:00');
  assert.strictEqual(nodes.note.dataset.tone, 'warn');
});

test('the last hour to add to an open order counts down next to the amount', () => {
  const { nodes, adopt } = harness();

  adopt(payload({
    orderStatus: 'groceries_ordered',
    etaStart: '2026-07-28T16:00:00.000+02:00',
    etaEnd: '2026-07-28T17:00:00.000+02:00',
    cutOffAt: '2026-07-27T23:00:00.000+02:00',
    cart: cart({ totalPrice: 12.4, productCount: 3 }),
    now: '2026-07-27T22:35:00.000+02:00'
  }));

  assert.strictEqual(noteOf(nodes), '3 more products in your cart / 25 minutes left to add them');
});

test('a cart with a slot picked is not an order yet, and says until when it can become one', () => {
  const { nodes, adopt, headline, detail } = harness();

  adopt(payload({ orderStatus: '', cart: cart(), now: '2026-07-28T10:00:00.000+02:00' }));

  assert.strictEqual(nodes.status.textContent, 'To order');
  assert.strictEqual(nodes.tile.dataset.tone, 'brand');
  assert.strictEqual(nodes['status-pill'].dataset.icon, 'basket');
  assert.strictEqual(headline(), 'Order before 23:00 Fri 19 Sep');
  assert.strictEqual(detail(), 'Sat 20 Sep 18:15–19:15');
  // how much and how many sit where an order shows them, at the top right
  assert.strictEqual(nodes.meta.textContent, '9 products · €22.03');
  assert.strictEqual(nodes.note.hidden, true);
});

test('a deadline today goes without its day', () => {
  const { adopt, headline } = harness();

  adopt(payload({ orderStatus: '', cart: cart(), now: '2026-07-28T10:00:00.000+02:00' }, {
    cart: { totalPrice: 32.86, productCount: 18, minimumShort: null, slotChosen: true, slotClosed: false, slot: { day: 'tomorrow', window: '08:30–09:30', cutOffAt: '2026-07-29T13:00:00.000+02:00', cutOffTime: '13:00', cutOffDay: 'today', cutOffLabel: 'today 13:00' } }
  }));

  assert.strictEqual(headline(), 'Order before 13:00');
});

test('below the minimum, the shortfall leads and the deadline goes under it', () => {
  const { nodes, adopt, headline, detail } = harness();

  adopt(payload({ orderStatus: '', cart: cart({ totalPrice: 32.86, productCount: 18, minimumOrderValue: 45 }), now: '2026-07-28T10:00:00.000+02:00' }));

  // nothing can be ordered until the minimum is made up, so that comes first
  assert.strictEqual(headline(), 'Below the minimum by €12.14');
  assert.strictEqual(detail(), 'Sat 20 Sep 18:15–19:15 · order before Fri 19 Sep 23:00');
  assert.strictEqual(nodes.meta.textContent, '18 products · €32.86');
  assert.strictEqual(nodes.note.hidden, true);
});

test('below the minimum with the deadline within the hour, the minutes go under the shortfall', () => {
  const { adopt, headline, detail } = harness();

  adopt(payload({ orderStatus: '', cart: cart({ totalPrice: 28.2, productCount: 1, minimumOrderValue: 35 }), now: '2026-07-29T22:20:00.000+02:00' }));

  assert.strictEqual(headline(), 'Below the minimum by €6.80');
  assert.strictEqual(detail(), 'Sat 20 Sep 18:15–19:15 · order within 40 min');
});

test('the last hour to order a picked slot is counted down, the number in the colour to hurry in', () => {
  const { nodes, adopt, headline } = harness();

  adopt(payload({ orderStatus: '', cart: cart(), now: '2026-07-29T22:20:00.000+02:00' }));

  assert.strictEqual(headline(), 'Order within 40 min');
  // the tile stays Picnic's red: it is still a cart to order, only in a hurry
  assert.strictEqual(nodes.tile.dataset.tone, 'brand');
  assert.strictEqual(nodes.headline.dataset.valueTone, 'warn');
});

test('a picked slot whose deadline passed asks for a new one, and says what there is to pick from', () => {
  const { adopt, headline, detail } = harness();

  adopt(payload({ orderStatus: '', cart: cart({ nextSlots: NEXT }), now: '2026-07-29T23:30:00.000+02:00' }));

  assert.strictEqual(headline(), 'Pick a new delivery slot');
  assert.strictEqual(detail(), 'tomorrow 3/12 free · first 08:30–09:30');
});

test('a cart without a picked slot asks for one, rather than naming Picnic\'s guess', () => {
  const { adopt, headline, detail } = harness();

  adopt(payload({
    orderStatus: '',
    cart: cart({ slot: { chosen: false, windowStart: '2026-07-28T18:15:00.000+02:00', windowEnd: '2026-07-28T19:15:00.000+02:00' }, nextSlots: NEXT }),
    now: '2026-07-28T10:00:00.000+02:00'
  }));

  assert.strictEqual(headline(), 'Pick a delivery slot');
  assert.strictEqual(detail(), 'tomorrow 3/12 free · first 08:30–09:30');
});

test('a cart without a slot and below the minimum says how much is missing underneath', () => {
  const { nodes, adopt, headline, detail } = harness();

  adopt(payload({ orderStatus: '', cart: cart({ totalPrice: 28.2, productCount: 1, minimumOrderValue: 35, slot: null }), now: '2026-07-28T10:00:00.000+02:00' }));

  assert.strictEqual(headline(), 'Pick a delivery slot');
  assert.strictEqual(detail(), '');
  assert.strictEqual(nodes.meta.textContent, '1 product · €28.20');
  assert.strictEqual(noteOf(nodes), '€6.80 short of the minimum');
  assert.strictEqual(nodes.note.dataset.tone, 'warn');
});

test('a cart without a slot and below the minimum names the free slots in two parts, the second giving way to the note', () => {
  const { nodes, adopt } = harness();

  adopt(payload({ orderStatus: '', cart: cart({ totalPrice: 28.2, productCount: 1, minimumOrderValue: 35, slot: null, nextSlots: NEXT }), now: '2026-07-28T10:00:00.000+02:00' }));

  // the first slot is what a half width tile hides under a note, as it does
  // the amount in the cart: what is free goes on its own line
  assert.strictEqual(nodes.when.textContent, 'tomorrow 3/12 free');
  assert.strictEqual(nodes.what.textContent, 'first 08:30–09:30');
  assert.strictEqual(nodes.detail.dataset.note, 'shown');
  assert.strictEqual(noteOf(nodes), '€6.80 short of the minimum');
});

test('an order days out has its window on its own for a half width tile with a note, the countdown naming the day', () => {
  const { nodes, adopt, headline, detail } = harness();

  adopt(payload({
    orderStatus: 'groceries_ordered',
    etaStart: '2026-07-30T16:00:00.000+02:00',
    etaEnd: '2026-07-30T17:00:00.000+02:00',
    cutOffAt: '2026-07-29T23:00:00.000+02:00',
    now: '2026-07-28T16:00:00.000+02:00'
  }, { day: 'Thu 30 Jul', cutOffLabel: 'Wed 29 Jul 23:00' }));

  assert.strictEqual(headline(), 'Delivery in 2 days');
  assert.strictEqual(detail(), 'Thu 30 Jul 16:11–16:31');
  assert.strictEqual(nodes['when-short'].textContent, '16:11–16:31');
  assert.strictEqual(nodes.detail.dataset.note, 'shown');
});

test('an order counted down in hours has its window on its own as well, which "tomorrow" would take onto a second line', () => {
  const { nodes, adopt, headline, detail } = harness();

  adopt(payload(Object.assign({ orderStatus: 'groceries_ordered', cutOffAt: '2026-07-28T13:00:00.000+02:00', now: '2026-07-28T10:00:00.000+02:00' }, WINDOW), { day: 'tomorrow' }));

  assert.strictEqual(headline(), 'Delivery in 6 hours');
  assert.strictEqual(detail(), 'tomorrow 16:11–16:31');
  assert.strictEqual(nodes['when-short'].textContent, '16:11–16:31');
});

test('a window that is not counted down to keeps its day', () => {
  const { nodes, adopt, headline } = harness();

  adopt(payload(Object.assign({ now: '2026-07-28T16:16:00.000+02:00' }, UNDERWAY)));

  assert.strictEqual(headline(), 'Any minute now');
  assert.strictEqual(nodes['when-short'].textContent, '');
});

test('a cart that can no longer be added to an order is not held over the reader', () => {
  const { nodes, adopt, headline } = harness();

  adopt(payload(Object.assign({ cutOffAt: '2026-07-27T23:00:00.000+02:00', cart: cart(), now: '2026-07-28T15:56:00.000+02:00' }, ANNOUNCED)));

  assert.strictEqual(headline(), 'Delivery in 15 min');
  assert.strictEqual(nodes.note.hidden, true);
});

test('amounts are written in Homey\'s language', () => {
  const { nodes, adopt } = harness();

  adopt(payload({ orderStatus: '', cart: cart({ slot: null }), now: '2026-07-28T10:00:00.000+02:00' }, { locale: 'nl' }));

  assert.strictEqual(nodes.meta.textContent, '9 products · €\u00a022,03');
});

test('no countdown on the widget is ever finer than a minute', () => {
  const seconds = script.match(/\/\s*1000\b/g);

  // the only divisions by a thousand would be seconds; minutes, hours and days
  // are divided by 60000 and up
  assert.strictEqual(seconds, null);
});

test('a widget that opens has Picnic asked straight away, next to showing what the app has', () => {
  const { calls, nodes } = harness();

  assert.deepStrictEqual(calls, ['GET /state', 'POST /refresh']);
  // the mark breathes while it waits
  assert.strictEqual(nodes.tile.dataset.refreshing, 'yes');
});

test('a tap has Picnic asked and buzzes, but not twice in half a minute', () => {
  const { calls, nodes, buzzes } = harness();
  const tap = nodes.tile.listeners.click;
  const opened = Date.now;

  try {
    // half a minute after opening, a tap asks again
    Date.now = () => opened() + 31 * 1000;
    tap();
    assert.deepStrictEqual(calls.filter(call => call == 'POST /refresh').length, 2);
    assert.strictEqual(buzzes.length, 1);

    // and a tap right after it is left alone, buzz and all
    tap();
    assert.deepStrictEqual(calls.filter(call => call == 'POST /refresh').length, 2);
    assert.strictEqual(buzzes.length, 1);
  } finally {
    Date.now = opened;
  }
});

test('coming back into view has Picnic asked, going out of it does not', () => {
  const { calls, page } = harness();
  const opened = Date.now;

  try {
    Date.now = () => opened() + 31 * 1000;

    page.hidden = true;
    page.listeners.visibilitychange();
    assert.strictEqual(calls.filter(call => call == 'POST /refresh').length, 1);

    page.hidden = false;
    page.listeners.visibilitychange();
    assert.strictEqual(calls.filter(call => call == 'POST /refresh').length, 2);
  } finally {
    Date.now = opened;
  }
});

test('an answer older than what is on screen is not shown over it', () => {
  const { adopt, headline } = harness();

  adopt(payload({ orderStatus: '', cart: cart(), now: '2026-07-29T22:20:00.000+02:00' }));
  adopt(payload({ orderStatus: '', cart: { totalPrice: 0, productCount: 0 }, now: '2026-07-29T22:19:00.000+02:00' }));

  assert.strictEqual(headline(), 'Order within 40 min');
});

test('every word the widget asks for is one the app hands over', () => {
  // the labels arrive from the app rather than from the locale file, so a key
  // the app leaves out is an empty string on the dashboard, not an error
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const handed = app.match(/_deliveryWidgetLabels\(\) \{[\s\S]*?\]\.forEach/)[0];
  const asked = new Set();

  for (const call of script.matchAll(/\b(?:label|text)\('([a-z-]+)'/g)) asked.add(call[1]);
  for (const entry of script.matchAll(/(?:status|short): '([a-z-]+)'/g)) asked.add(entry[1]);

  asked.forEach(key => {
    assert.ok(handed.includes('"' + key + '"'), 'the widget asks for "' + key + '" but the app does not hand it over');
    assert.ok(LABELS[key], 'no English text for "' + key + '"');
  });
});

test('a placed order with twenty minutes left to add to says so, whatever the delivery is still hours away', () => {
  const { nodes, adopt, headline, detail } = harness();

  adopt(payload({
    orderStatus: 'groceries_ordered',
    etaStart: '2026-09-19T08:30:00.000+02:00',
    etaEnd: '2026-09-19T09:30:00.000+02:00',
    cutOffAt: '2026-09-18T13:00:00.000+02:00',
    cart: { totalPrice: 0, productCount: 0 },
    now: '2026-09-18T12:40:00.000+02:00'
  }));

  assert.strictEqual(nodes.status.textContent, 'Pending order');
  assert.strictEqual(headline(), 'Delivery in 20 hours');
  assert.strictEqual(noteOf(nodes), '20 minutes left to add to it');
  assert.strictEqual(nodes.note.dataset.tone, 'warn');
});

test('an order in hand is shown in a calm colour, the cart that still has to be ordered in red', () => {
  const ordered = harness();
  ordered.adopt(payload({ orderStatus: 'groceries_ordered', etaStart: '2026-09-19T08:30:00.000+02:00', etaEnd: '2026-09-19T09:30:00.000+02:00', now: '2026-09-18T12:40:00.000+02:00' }));

  const cartOnly = harness();
  cartOnly.adopt(payload({ orderStatus: '', cart: cart(), now: '2026-07-28T10:00:00.000+02:00' }));

  assert.strictEqual(ordered.nodes.tile.dataset.tone, 'calm');
  assert.strictEqual(cartOnly.nodes.tile.dataset.tone, 'brand');
});

test('the caption says what the number is, and a sentence goes without one', () => {
  const { nodes, adopt } = harness();

  adopt(payload(Object.assign({ now: '2026-07-28T15:56:00.000+02:00' }, ANNOUNCED)));
  assert.strictEqual(nodes.caption.textContent, 'Delivery in');
  assert.strictEqual(nodes.caption.hidden, false);

  adopt(payload(Object.assign({ now: '2026-07-28T16:16:00.000+02:00' }, ANNOUNCED)));
  assert.strictEqual(nodes.caption.hidden, true);
  assert.strictEqual(nodes.value.textContent, 'Any minute now');
});

test('products in the cart while an order is open are said first, with the time left to add them', () => {
  const { nodes, adopt, headline, detail } = harness();

  // one product of 1,59 in the cart, eleven minutes left, 29 products ordered
  adopt(payload({
    orderStatus: 'groceries_ordered',
    etaStart: '2026-09-19T08:30:00.000+02:00',
    etaEnd: '2026-09-19T09:30:00.000+02:00',
    cutOffAt: '2026-09-18T13:00:00.000+02:00',
    cart: { totalPrice: 1.59, productCount: 1 },
    now: '2026-09-18T12:49:00.000+02:00'
  }, { orderCount: 29, price: 53.43 }));

  assert.strictEqual(nodes.meta.textContent, '29 products · €53.43');
  assert.strictEqual(headline(), 'Delivery in 20 hours');
  assert.strictEqual(detail(), 'today 16:11–16:31 · €1.59 in cart');
  assert.strictEqual(noteOf(nodes), '1 more product in your cart / 11 minutes left to add them');
  assert.strictEqual(shortNoteOf(nodes), '1 product · 11\u00a0min\u00a0left');
  assert.strictEqual(nodes.note.dataset.tone, 'warn');
  // which a half width tile has room for instead of the amount
  assert.strictEqual(nodes.detail.dataset.note, 'shown');
});

test('the last minute to add is not pluralised', () => {
  const { nodes, adopt } = harness();

  adopt(payload({
    orderStatus: 'groceries_ordered',
    etaStart: '2026-09-19T08:30:00.000+02:00',
    etaEnd: '2026-09-19T09:30:00.000+02:00',
    cutOffAt: '2026-09-18T13:00:00.000+02:00',
    cart: { totalPrice: 3.18, productCount: 2 },
    now: '2026-09-18T12:59:30.000+02:00'
  }));

  assert.strictEqual(noteOf(nodes), '2 more products in your cart / 1 minute left to add them');
});

test('hours before the deadline, the cart still to add says until when, not yet in red', () => {
  const { nodes, adopt } = harness();

  adopt(payload({
    orderStatus: 'groceries_ordered',
    etaStart: '2026-09-19T08:30:00.000+02:00',
    etaEnd: '2026-09-19T09:30:00.000+02:00',
    cutOffAt: '2026-09-18T13:00:00.000+02:00',
    now: '2026-09-18T09:00:00.000+02:00'
  }));

  assert.strictEqual(noteOf(nodes), 'Can be added to until today 23:00');
  assert.strictEqual(shortNoteOf(nodes), 'Can be added to until today 23:00');
  assert.strictEqual(nodes.note.dataset.tone, '');
});

// the short forms keep a number and its unit together, so a half width tile
// never ends a line on "11" and starts the next one with "min"
test('an empty cart in the last hour gives the short form its own words', () => {
  const { nodes, adopt } = harness();

  adopt(payload({
    orderStatus: 'groceries_ordered',
    etaStart: '2026-09-19T08:30:00.000+02:00',
    etaEnd: '2026-09-19T09:30:00.000+02:00',
    cutOffAt: '2026-09-18T13:00:00.000+02:00',
    now: '2026-09-18T12:43:00.000+02:00'
  }));

  assert.strictEqual(noteOf(nodes), '17 minutes left to add to it');
  assert.strictEqual(shortNoteOf(nodes), '17\u00a0min left to add');
});

test('a one line note is the same on every tile', () => {
  const { nodes, adopt } = harness();

  adopt(payload({ orderStatus: '', cart: cart({ totalPrice: 28.2, productCount: 1, minimumOrderValue: 35, slot: null }), now: '2026-07-28T10:00:00.000+02:00' }));

  assert.strictEqual(noteOf(nodes), '€6.80 short of the minimum');
  assert.strictEqual(shortNoteOf(nodes), '€6.80 short of the minimum');
  assert.strictEqual(nodes['note-second'].hidden, true);
});

test('nothing planned says when something could be, on a line of its own', () => {
  const { nodes, adopt, headline, detail } = harness();

  adopt(payload({ orderStatus: '', cart: { totalPrice: 0, productCount: 0, nextSlots: NEXT }, now: '2026-07-28T16:40:00.000+02:00' }));

  assert.strictEqual(headline(), 'No pending order');
  assert.strictEqual(detail(), 'Your cart is empty');
  // the first slot by its window, which is what gets booked
  assert.strictEqual(noteOf(nodes), 'Slots tomorrow: 3 of 12 free / First slot 08:30–09:30');
  assert.strictEqual(shortNoteOf(nodes), 'tomorrow 3/12 free / first 08:30–09:30');
  assert.strictEqual(nodes.note.dataset.tone, '');
});

// an empty cart with a slot picked for tomorrow afternoon, which can be
// ordered for until 23:00 tonight
function emptyWithSlot() {
  return {
    totalPrice: 0,
    productCount: 0,
    slot: { chosen: true, windowStart: '2026-07-29T14:30:00.000+02:00', windowEnd: '2026-07-29T15:30:00.000+02:00', cutOffAt: '2026-07-28T23:00:00.000+02:00' },
    nextSlots: NEXT
  };
}

test('an empty cart with a slot picked names that slot rather than the free ones', () => {
  const { nodes, adopt, headline, detail } = harness();

  adopt(payload({ orderStatus: '', cart: emptyWithSlot(), now: '2026-07-28T16:40:00.000+02:00' }));

  assert.strictEqual(headline(), 'No pending order');
  assert.strictEqual(detail(), 'Your cart is empty');
  assert.strictEqual(noteOf(nodes), 'Chosen slot: tomorrow 14:30–15:30 / Order before 23:00');
  // on a line each on a half width tile, so the deadline is never cut off
  assert.strictEqual(shortNoteOf(nodes), 'tomorrow 14:30–15:30 / Order before 23:00');
  assert.strictEqual(nodes['note-short-lines'].dataset.lines, '2');
  assert.strictEqual(nodes.note.dataset.tone, '');
});

test('the last hour to order for a picked slot is counted down', () => {
  const { nodes, adopt } = harness();

  adopt(payload({ orderStatus: '', cart: emptyWithSlot(), now: '2026-07-28T22:20:00.000+02:00' }));

  assert.strictEqual(noteOf(nodes), 'Chosen slot: tomorrow 14:30–15:30 / Order within 40 min');
  assert.strictEqual(nodes.note.dataset.tone, 'warn');
});

test('a first slot without an end is named by its start', () => {
  const { nodes, adopt } = harness();

  adopt(payload({ orderStatus: '', cart: { totalPrice: 0, productCount: 0, nextSlots: Object.assign({}, NEXT, { windowEnd: null }) }, now: '2026-07-28T16:40:00.000+02:00' }));

  assert.strictEqual(noteOf(nodes), 'Slots tomorrow: 3 of 12 free / First at 08:30');
});

test('the state\'s icon sits in front of its name, and on its own where there is no name', () => {
  const named = harness();
  named.adopt(payload(Object.assign({ now: '2026-07-28T15:56:00.000+02:00' }, UNDERWAY)));

  assert.strictEqual(named.nodes['status-pill'].hidden, false);
  assert.strictEqual(named.nodes['status-icon'].attributes.href, '#i-truck');
  assert.strictEqual(named.nodes.badge.hidden, true);

  const nameless = harness();
  nameless.adopt(payload(Object.assign({ signInNeeded: true, now: '2026-07-28T16:40:00.000+02:00' }, ANNOUNCED)));

  assert.strictEqual(nameless.nodes['status-pill'].hidden, true);
  assert.strictEqual(nameless.nodes.badge.hidden, false);
  assert.strictEqual(nameless.nodes['badge-icon'].attributes.href, '#i-alert');
  assert.strictEqual(nameless.nodes.tile.dataset.tone, 'warn');
});

test('the mark is on every tile, whatever the state', () => {
  // the mark is the widget's own markup rather than something the script
  // puts there, so it is there before the app has said anything at all
  assert.ok(/class="logo"[^>]*>\s*<svg>\s*<use href="#picnic-mark"/.test(html));
  assert.ok(html.includes('<symbol id="picnic-mark"'));
});

// The states the gallery shows (scripts/widget-gallery.js) go through the
// widget here too, in both languages: a state that renders with nothing large
// on it, or does not render at all, is caught before anyone opens the gallery.
const { widgetStates } = require('./support/widgetstates.js');

['nl', 'en'].forEach(language => {
  test('every state in the gallery renders in ' + language, () => {
    const states = widgetStates(language, '2026-09-18T11:06:00.000+02:00');

    for (const id in states) {
      const { nodes, adopt, headline } = harness();
      adopt(states[id].payload);

      assert.ok(headline() != '', id + ' has no headline');
      assert.ok(nodes.tile.dataset.tone, id + ' has no tone');
      // a note or a detail that is shown is never empty words
      if (!nodes.note.hidden) assert.ok(nodes['note-first'].textContent && nodes['note-short'].textContent, id + ' has an empty note');
      if (!nodes.detail.hidden) assert.ok(nodes.when.textContent || nodes.what.textContent, id + ' has an empty detail line');
      // no label placeholder ever reaches the screen
      NODES.forEach(node => assert.ok(!/__[a-z]__/.test(nodes[node].textContent), id + ' shows a raw placeholder in ' + node));
    }
  });
});

test('a deadline on another day carries that day as its unit, and hands it to the caption for a half width tile', () => {
  const { nodes, adopt, headline } = harness();

  adopt(payload({ orderStatus: '', cart: cart(), now: '2026-07-28T10:00:00.000+02:00' }));
  assert.strictEqual(headline(), 'Order before 23:00 Fri 19 Sep');
  assert.strictEqual(nodes.unit.dataset.unit, 'day');
  assert.strictEqual(nodes.caption.dataset.day, ' Fri 19 Sep');

  // a unit that is a word stays where it is, whatever the width
  adopt(payload({ orderStatus: '', cart: cart(), now: '2026-07-29T22:20:00.000+02:00' }));
  assert.strictEqual(headline(), 'Order within 40 min');
  assert.strictEqual(nodes.unit.dataset.unit, '');
  assert.strictEqual(nodes.caption.dataset.day, undefined);
});

test('an announced window is a pending order without a bar, until the van leaves', () => {
  const { nodes, adopt, headline } = harness();

  adopt(payload(Object.assign({ now: '2026-07-28T15:56:00.000+02:00' }, ANNOUNCED)));

  assert.strictEqual(nodes.status.textContent, 'Pending order');
  assert.strictEqual(nodes['status-pill'].dataset.icon, 'scheduled');
  assert.strictEqual(headline(), 'Delivery in 15 min');
  assert.strictEqual(nodes.track.hidden, true);

  adopt(payload(Object.assign({ now: '2026-07-28T15:56:00.000+02:00' }, UNDERWAY)));

  assert.strictEqual(nodes.status.textContent, 'On its way');
  assert.strictEqual(nodes['status-pill'].dataset.icon, 'truck');
  assert.strictEqual(nodes.track.hidden, false);
});

test('a name that does not fit gives up the product count first, and then its length', () => {
  const { nodes, adopt, render } = harness();
  const order = payload({ orderStatus: 'groceries_ordered', etaStart: '2026-07-30T16:00:00.000+02:00', etaEnd: '2026-07-30T17:00:00.000+02:00', now: '2026-07-28T16:00:00.000+02:00' }, { orderCount: 29, price: 53.43 });

  adopt(order);
  assert.strictEqual(nodes.status.textContent, 'Pending order');
  assert.strictEqual(nodes.meta.textContent, '29 products · €53.43');

  // the name is wider than its box while the count is next to it
  nodes.status.clientWidth = 100;
  Object.defineProperty(nodes.status, 'scrollWidth', { get: () => nodes.meta.textContent.indexOf('products') != -1 ? 131 : 100, configurable: true });
  render();
  assert.strictEqual(nodes.meta.textContent, '€53.43');
  assert.strictEqual(nodes.status.textContent, 'Pending order');

  // and wider than its box whatever is next to it: a half width tile
  Object.defineProperty(nodes.status, 'scrollWidth', { get: () => 131, configurable: true });
  render();
  assert.strictEqual(nodes.status.textContent, 'Ordered');
});
