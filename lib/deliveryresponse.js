'use strict';

// What Picnic's GET /api/15/deliveries/{id} says about a delivery once it has
// been made: when it actually arrived, what it cost and what came back in
// deposit. Kept free of Homey APIs so it can be unit tested on its own.
//
// Like the cart, this is read behind someone's back, so a field that is not
// there leaves that part of the widget empty rather than throwing.

function isNumber(value) {
  return typeof value == 'number' && isFinite(value);
}

// Picnic counts in cents.
function euros(cents) {
  return isNumber(cents) ? cents / 100 : null;
}

// The sum of a field over a list, or null when not one entry carries it.
function total(list, read) {
  var sum = null;

  (Array.isArray(list) ? list : []).forEach(entry => {
    const value = entry && read(entry);
    if (isNumber(value)) sum = (sum === null ? 0 : sum) + value;
  });

  return sum;
}

// What the customer pays for an order. checkout_total_price is what the
// checkout shows, total_price what the summary carries; the first is taken
// when there is one.
function orderPrice(order) {
  return isNumber(order['checkout_total_price']) ? order['checkout_total_price'] : order['total_price'];
}

// How many products an order holds. Picnic does not total it up for a placed
// order the way it does for the cart, but every article in it carries a
// QUANTITY decorator, so a line of three yoghurts counts three.
function productCount(orders) {
  var count = null;

  (Array.isArray(orders) ? orders : []).forEach(order => {
    const lines = order && Array.isArray(order['items']) ? order['items'] : [];

    lines.forEach(line => {
      const articles = line && Array.isArray(line['items']) ? line['items'] : [];

      articles.forEach(article => {
        const decorators = article && Array.isArray(article['decorators']) ? article['decorators'] : [];
        const quantity = decorators.find(decorator => decorator && decorator['type'] == 'QUANTITY');

        count = (count === null ? 0 : count) + (quantity && isNumber(quantity['quantity']) ? quantity['quantity'] : 1);
      });
    });
  });

  return count;
}

// What a container is called, without the "1 x" Picnic puts in front of some:
// a can is "1 x blikje", and the widget puts the number that came back in front
// of the name itself, which made that "1× 1 x blikje". A larger count is kept,
// since it says what one of them is: a pack, not a can.
function containerName(name) {
  if (typeof name != 'string') return "";
  return name.replace(/^\s*1\s*[x×]\s+/i, "").trim();
}

/**
 * The facts about a delivery: when it arrived once it has, what it costs, how
 * much is in it, and what came back in deposit.
 *
 * @param {string|Object} body the response body
 * @returns {Object|null} as { deliveryId, deliveredAt, totalPrice, productCount, depositPaid, depositReturned, returned }
 */
function parseDelivery(body) {
  var parsed = body;

  if (typeof body == 'string') {
    try {
      parsed = JSON.parse(body);
    } catch (exception) {
      return null;
    }
  }

  if (parsed === null || typeof parsed != 'object' || Array.isArray(parsed)) return null;

  const deliveryTime = parsed['delivery_time'];
  const deliveredAt = deliveryTime && typeof deliveryTime == 'object' && typeof deliveryTime['start'] == 'string' && deliveryTime['start'] != ""
    ? deliveryTime['start']
    : null;

  // Bottles, crates and bags handed back to the driver. Picnic only fills
  // this in once the hub has counted them, which is some time after the
  // delivery itself, so an empty list means "not counted yet" as much as
  // "nothing returned". Each entry's price is taken to be per unit.
  const containers = (Array.isArray(parsed['returned_containers']) ? parsed['returned_containers'] : [])
    .filter(container => container && isNumber(container['quantity']) && container['quantity'] > 0);

  const returned = containers.map(container => ({
    "name": containerName(container['localized_name']),
    "quantity": container['quantity'],
    "amount": isNumber(container['price']) ? container['price'] * container['quantity'] / 100 : null
  }));

  return {
    "deliveryId": typeof parsed['delivery_id'] == 'string' ? parsed['delivery_id'] : null,
    "deliveredAt": deliveredAt,
    // every order in the delivery, which is more than one once something has
    // been added to it after it was placed
    "totalPrice": euros(total(parsed['orders'], orderPrice)),
    "productCount": productCount(parsed['orders']),
    "depositPaid": euros(total(parsed['orders'], order => order['total_deposit'])),
    "depositReturned": returned.length == 0 ? null : euros(total(containers, container =>
      isNumber(container['price']) ? container['price'] * container['quantity'] : null)),
    "returned": returned
  };
}

module.exports = { parseDelivery };
