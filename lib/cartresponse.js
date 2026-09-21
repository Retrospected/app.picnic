'use strict';

// What Picnic's answer to adding a product to the cart says about that
// product. Picnic returns the whole cart when it worked and, when the product
// is already in the cart, that same cart alongside an error code, so the cart
// is what gets looked at first and the code only decides what went wrong.
//
// Nothing here assumes the shape of the answer. This runs inside a response
// handler, where a thrown exception is caught by nobody and takes the app down
// with it, so an answer that makes no sense has to come back as a plain "this
// did not work" rather than as a TypeError.
function parseAddProductResponse(body, productId) {
  var parsed;

  try {
    parsed = JSON.parse(body);
  } catch (exception) {
    return { error: 'Unexpected response from server', reason: 'the response is not json' };
  }

  if (parsed === null || typeof parsed !== 'object') {
    return { error: 'Unexpected response from server', reason: 'the response is not an object' };
  }

  const name = findProductName(parsed['items'], productId);

  if (name !== undefined) {
    return { name: name };
  }

  const code = parsed['error'] && parsed['error']['code'];

  if (code === 'UNPROCESSABLE_ENTITY') {
    return { error: 'Cart was locked', code: code };
  }

  return {
    error: 'Unexpected response from server',
    code: code || undefined,
    reason: 'the cart Picnic sent back does not mention the product'
  };
}

// The cart comes back as groups of lines, and only the line for this product
// carries the name to report.
function findProductName(groups, productId) {
  if (!Array.isArray(groups)) return undefined;

  for (const group of groups) {
    const lines = group && group['items'];

    if (!Array.isArray(lines)) continue;

    const line = lines.find(line => line && line['id'] == productId);

    if (line && typeof line['name'] === 'string') return line['name'];
  }

  return undefined;
}

// Picnic counts in cents. A value that is not a number is a field that is not
// there, or is no longer what it was, and either way there is no amount to show.
function euros(cents) {
  if (typeof cents != 'number' || !isFinite(cents)) return null;
  return cents / 100;
}

// How many products are in the cart. Picnic totals it up itself, but the cart
// is also there line by line, so it can be counted if it ever stops doing that.
function countProducts(cart) {
  if (typeof cart['total_count'] == 'number' && isFinite(cart['total_count'])) return cart['total_count'];

  const groups = cart['items'];
  if (!Array.isArray(groups)) return null;

  var total = 0;

  for (const group of groups) {
    const lines = group && group['items'];
    if (!Array.isArray(lines)) continue;

    for (const line of lines) {
      total = total + (typeof line['count'] == 'number' && isFinite(line['count']) ? line['count'] : 1);
    }
  }

  return total;
}

// A timestamp Picnic hands out, or null for anything that is not one.
function timestamp(value) {
  return typeof value == 'string' && value != "" ? value : null;
}

// The slot the cart would be delivered in, looked up by the id the cart points
// at. The cart only names the slot; the window belongs to the list next to it.
function selectedSlotEntry(cart) {
  const selected = cart['selected_slot'];
  if (selected === null || typeof selected != 'object') return null;

  const slots = cart['delivery_slots'];
  if (!Array.isArray(slots)) return null;

  return slots.find(slot => slot && slot['slot_id'] == selected['slot_id']) || null;
}

// What this order has to be worth before Picnic will deliver it. It lives on
// the slot, since it can differ from one slot to the next, but the cart and
// selected_slot are looked at too in case that ever moves.
function minimumOrderValue(cart) {
  if (typeof cart['minimum_order_value'] == 'number') return cart['minimum_order_value'];

  const selected = cart['selected_slot'];
  if (selected !== null && typeof selected == 'object' && typeof selected['minimum_order_value'] == 'number') {
    return selected['minimum_order_value'];
  }

  const slot = selectedSlotEntry(cart);
  return slot && typeof slot['minimum_order_value'] == 'number' ? slot['minimum_order_value'] : null;
}

// The delivery moment the cart is set to. Picnic always has one in mind, but
// until someone picks it in the app it is Picnic's suggestion ("IMPLICIT")
// rather than a choice ("EXPLICIT"), and a suggestion is not held for anyone.
function deliverySlot(cart) {
  const selected = cart['selected_slot'];
  if (selected === null || typeof selected != 'object') return null;

  const slot = selectedSlotEntry(cart) || {};

  return {
    "chosen": selected['state'] == 'EXPLICIT',
    "windowStart": timestamp(slot['window_start']),
    "windowEnd": timestamp(slot['window_end']),
    "cutOffAt": timestamp(slot['cut_off_time'])
  };
}

// The first day something can still be delivered on: how many of its slots
// are open, out of how many it has, and the earliest open one. Picnic lists
// two weeks of slots with the cart, each with an is_available, and groups
// them by the day in the slot's own timezone, which is what the date part of
// its window_start spells out. A day with nothing open is passed over: it is
// the next chance to order that is worth knowing about.
function nextSlots(cart) {
  const slots = cart['delivery_slots'];
  if (!Array.isArray(slots)) return null;

  const days = {};
  const order = [];

  for (const slot of slots) {
    const start = slot && timestamp(slot['window_start']);
    if (start === null || start.length < 10) continue;

    const day = start.slice(0, 10);

    if (!days[day]) {
      days[day] = { "total": 0, "available": 0, "first": null };
      order.push(day);
    }

    days[day]["total"]++;

    if (slot['is_available'] === true) {
      days[day]["available"]++;
      if (days[day]["first"] === null || start < days[day]["first"]["window_start"]) days[day]["first"] = slot;
    }
  }

  order.sort();

  for (const day of order) {
    const counted = days[day];
    if (counted["available"] === 0) continue;

    return {
      "windowStart": timestamp(counted["first"]['window_start']),
      "windowEnd": timestamp(counted["first"]['window_end']),
      "available": counted["available"],
      "total": counted["total"]
    };
  }

  return null;
}

/**
 * What the cart says about itself: the numbers at the top of it rather than the
 * products in it. Picnic hands back the whole cart on every call that touches
 * it and this is asked for it behind someone's back, so a field that is not
 * there leaves that part of the widget empty rather than throwing.
 *
 * @param {string|Object} body the response body
 * @returns {Object|null} the cart, as { totalPrice, productCount, minimumOrderValue, slot, nextSlots }
 */
function parseCart(body) {
  var parsed = body;

  if (typeof body == 'string') {
    try {
      parsed = JSON.parse(body);
    } catch (exception) {
      return null;
    }
  }

  // an array parses as an object, and Picnic answering with a list is Picnic
  // answering with something that is not a cart
  if (parsed === null || typeof parsed != 'object' || Array.isArray(parsed)) return null;

  return {
    // What the cart is worth, every discount included: on a real cart
    // total_price was its lines (43,60) minus total_savings (9,27) minus the
    // Family discount in membership_savings (1,47), the 32,86 Picnic's app
    // showed. That only holds for a current x-picnic-agent, see
    // lib/picnicheaders.js. checkout_total_price held the same number, and is
    // preferred only because it is the one a placed order states as paid.
    "totalPrice": euros(typeof parsed['checkout_total_price'] == 'number' ? parsed['checkout_total_price'] : parsed['total_price']),
    "productCount": countProducts(parsed),
    "minimumOrderValue": euros(minimumOrderValue(parsed)),
    "slot": deliverySlot(parsed),
    // the next day something could be delivered on, whatever is in the cart
    "nextSlots": nextSlots(parsed)
  };
}

module.exports = { parseAddProductResponse, parseCart };
