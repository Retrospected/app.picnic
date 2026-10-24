// What Picnic's GET /api/15/deliveries/{id} says about a delivery once it has
// been made: when it actually arrived, what it cost and what came back in
// deposit. Kept free of Homey APIs so it can be unit tested on its own.
//
// Like the cart, this is read behind someone's back, so a field that is not
// there leaves that part of the widget empty rather than throwing.

import type { PicnicJson } from './picnicjson';

// a bottle, crate or bag handed back to the driver
export interface ReturnedContainer {
  name: string;
  quantity: number;
  amount: number | null;
}

export interface Delivery {
  deliveryId: string | null;
  deliveredAt: string | null;
  totalPrice: number | null;
  productCount: number | null;
  depositPaid: number | null;
  depositReturned: number | null;
  returned: ReturnedContainer[];
}

function isNumber(value: unknown): value is number {
  return typeof value == 'number' && isFinite(value);
}

// Picnic counts in cents.
function euros(cents: unknown): number | null {
  return isNumber(cents) ? cents / 100 : null;
}

// The sum of a field over a list, or null when not one entry carries it.
function total(list: unknown, read: (entry: PicnicJson) => unknown): number | null {
  var sum: number | null = null;

  (Array.isArray(list) ? list : []).forEach((entry: PicnicJson) => {
    const value = entry && read(entry);
    if (isNumber(value)) sum = (sum === null ? 0 : sum) + value;
  });

  return sum;
}

// What the customer pays for an order. checkout_total_price is what the
// checkout shows, total_price what the summary carries; the first is taken
// when there is one.
function orderPrice(order: PicnicJson): unknown {
  return isNumber(order['checkout_total_price']) ? order['checkout_total_price'] : order['total_price'];
}

// How many products an order holds. Picnic does not total it up for a placed
// order the way it does for the cart, but every article in it carries a
// QUANTITY decorator, so a line of three yoghurts counts three.
function productCount(orders: unknown): number | null {
  var count: number | null = null;

  (Array.isArray(orders) ? orders : []).forEach((order: PicnicJson) => {
    const lines = order && Array.isArray(order['items']) ? order['items'] : [];

    lines.forEach((line: PicnicJson) => {
      const articles = line && Array.isArray(line['items']) ? line['items'] : [];

      articles.forEach((article: PicnicJson) => {
        const decorators = article && Array.isArray(article['decorators']) ? article['decorators'] : [];
        const quantity = decorators.find((decorator: PicnicJson) => decorator && decorator['type'] == 'QUANTITY');

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
function containerName(name: unknown): string {
  if (typeof name != 'string') return "";
  return name.replace(/^\s*1\s*[x×]\s+/i, "").trim();
}

/**
 * The facts about a delivery: when it arrived once it has, what it costs, how
 * much is in it, and what came back in deposit.
 *
 * @param body the response body
 * @returns the delivery, or null when the answer is not one
 */
export function parseDelivery(body: unknown): Delivery | null {
  var parsed: PicnicJson = body;

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
    .filter((container: PicnicJson) => container && isNumber(container['quantity']) && container['quantity'] > 0);

  const returned: ReturnedContainer[] = containers.map((container: PicnicJson) => ({
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
    "depositPaid": euros(total(parsed['orders'], (order: PicnicJson) => order['total_deposit'])),
    "depositReturned": returned.length == 0 ? null : euros(total(containers, (container: PicnicJson) =>
      isNumber(container['price']) ? container['price'] * container['quantity'] : null)),
    "returned": returned
  };
}
