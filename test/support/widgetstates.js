'use strict';

// Every state the delivery widget can be in, as the payload the app hands it
// (see getDeliveryWidgetState in app.js), for the gallery in
// scripts/widget-gallery.js and for the tests alike. The moments are taken
// relative to now, so a countdown is always caught mid-count, and the words
// come from the locale files, so the gallery shows what a dashboard would.

const fs = require('fs');
const path = require('path');

function labelsFor(language) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'locales', language + '.json'), 'utf8')).widget.delivery;
}

/**
 * @param {string} language 'nl' or 'en'
 * @param {string|number} [at] the moment to take as now, default the real one
 * @returns {Object} states by id, each { title, payload }
 */
function widgetStates(language, at) {
  const labels = labelsFor(language || 'nl');
  const now = at ? new Date(at).getTime() : Date.now();
  const iso = minutes => new Date(now + minutes * 60000).toISOString();
  const today = labels['today'];
  const tomorrow = labels['tomorrow'];

  // an order of 29 products, delivered tomorrow morning
  const order = { price: 53.43, orderCount: 29, day: tomorrow, window: '08:30–09:30' };
  const slots = { day: tomorrow, time: '08:30', window: '08:30–09:30', available: 3, total: 12 };

  const states = {
    'ordered-cart': {
      title: 'Ordered, something waiting in the cart, deadline in 11 minutes',
      payload: Object.assign({ state: 'ordered', countdownTo: iso(20 * 60), cutOffAt: iso(11), cutOffLabel: today + ' 13:00', cart: { totalPrice: 1.59, productCount: 1 } }, order)
    },
    'ordered-early': {
      title: 'Ordered, hours before the deadline, empty cart',
      payload: Object.assign({ state: 'ordered', countdownTo: iso(26 * 60), cutOffAt: iso(5 * 60), cutOffLabel: today + ' 13:00', cart: null }, order)
    },
    'ordered-closed': {
      title: 'Ordered, past the deadline',
      payload: Object.assign({ state: 'ordered', countdownTo: iso(19 * 60), cutOffAt: null, cutOffLabel: '', cart: null }, order)
    },
    'ordered-days': {
      title: 'Ordered, days ahead',
      payload: Object.assign({ state: 'ordered', countdownTo: iso(3 * 24 * 60), cutOffAt: iso(2 * 24 * 60), cutOffLabel: 'za 20 sep 13:00', cart: null }, order, { day: 'za 20 sep' })
    },
    'announced': {
      title: 'Window announced for tomorrow, van not on the road yet',
      payload: Object.assign({ state: 'announced', countdownTo: iso(19 * 60), progress: null, cutOffAt: null, cart: null }, order, { window: '08:59–09:19', windowEnd: iso(19 * 60 + 20) })
    },
    'underway': {
      // left 40 minutes ago, 14 to the window and 20 in it
      title: 'Van on the road, 14 minutes out',
      payload: Object.assign({ state: 'underway', countdownTo: iso(14), progress: 0.54 }, order, { day: today, window: '16:11–16:31', windowEnd: iso(34) })
    },
    'arriving': {
      // left 35 minutes ago, 5 into the 20 minute window
      title: 'Arriving, inside the window',
      payload: Object.assign({ state: 'arriving', countdownTo: iso(-5), progress: 0.7 }, order, { day: today, window: '16:11–16:31', windowEnd: iso(15) })
    },
    'overdue': {
      title: 'Late, 12 minutes past the window',
      payload: Object.assign({ state: 'overdue', countdownTo: iso(-32), progress: 1 }, order, { day: today, window: '16:11–16:31', windowEnd: iso(-12) })
    },
    'delivered': {
      title: 'Delivered, deposit not counted yet',
      payload: Object.assign({ state: 'delivered', deliveredTime: '08:47', deposit: null }, order, { day: today, window: '' })
    },
    'delivered-deposit': {
      title: 'Delivered, deposit counted and the payment settled',
      payload: Object.assign({ state: 'delivered', deliveredTime: '08:47', deposit: { returned: 0.54, containers: [{ name: 'blikje', quantity: 1 }, { name: 'Tasjes', quantity: 1 }] } }, order, { price: 51.89, day: today, window: '' })
    },
    'cart-minimum': {
      title: 'Cart below the minimum, slot picked',
      payload: { state: 'cart', cart: { totalPrice: 32.86, productCount: 18, minimumShort: 12.14, slotChosen: true, slotClosed: false, slot: { day: tomorrow, window: '08:30–09:30', cutOffAt: iso(2 * 60), cutOffTime: '13:00', cutOffDay: today, cutOffLabel: today + ' 13:00' } }, nextSlots: slots }
    },
    'cart-slot': {
      title: 'Cart above the minimum, slot picked, deadline tomorrow',
      payload: { state: 'cart', cart: { totalPrice: 47.2, productCount: 22, minimumShort: null, slotChosen: true, slotClosed: false, slot: { day: 'za 20 sep', window: '18:15–19:15', cutOffAt: iso(30 * 60), cutOffTime: '23:00', cutOffDay: tomorrow, cutOffLabel: tomorrow + ' 23:00' } }, nextSlots: slots }
    },
    'cart-urgent': {
      title: 'Cart above the minimum, deadline in 41 minutes',
      payload: { state: 'cart', cart: { totalPrice: 47.2, productCount: 22, minimumShort: null, slotChosen: true, slotClosed: false, slot: { day: tomorrow, window: '08:30–09:30', cutOffAt: iso(41), cutOffTime: '13:00', cutOffDay: today, cutOffLabel: today + ' 13:00' } }, nextSlots: slots }
    },
    'cart-no-slot': {
      title: 'Cart without a slot',
      payload: { state: 'cart', cart: { totalPrice: 21.15, productCount: 7, minimumShort: 23.85, slotChosen: false, slotClosed: false, slot: null }, nextSlots: slots }
    },
    'cart-slot-closed': {
      title: 'Cart whose slot closed unordered',
      payload: { state: 'cart', cart: { totalPrice: 47.2, productCount: 22, minimumShort: null, slotChosen: true, slotClosed: true, slot: null }, nextSlots: slots }
    },
    'empty': {
      title: 'Nothing planned, empty cart',
      payload: { state: 'empty', cartKnown: true, nextSlots: slots }
    },
    'empty-slot': {
      title: 'Nothing planned, empty cart with a slot picked',
      payload: { state: 'empty', cartKnown: true, nextSlots: slots, chosenSlot: { day: tomorrow, window: '14:30–15:30', cutOffAt: iso(8 * 60), cutOffTime: '23:00', cutOffDay: today, cutOffLabel: today + ' 23:00' } }
    },
    'empty-unknown': {
      title: 'Nothing planned, cart never asked about',
      payload: { state: 'empty', cartKnown: false, nextSlots: null }
    },
    'signed-out': {
      title: 'Picnic wants a sign in',
      payload: { state: 'signed_out' }
    },
    'stale': {
      title: 'No word from Picnic in over a day',
      payload: { state: 'stale', checkedLabel: 'zo 5 apr 08:00' }
    }
  };

  for (const id in states) {
    Object.assign(states[id].payload, {
      now: new Date(now).toISOString(),
      locale: language == 'en' ? 'en-US' : 'nl-NL',
      labels
    });
  }

  return states;
}

module.exports = { widgetStates, labelsFor };
