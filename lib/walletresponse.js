'use strict';

// What Picnic's wallet says about payments: POST /api/15/wallet/transactions
// lists them, newest first, and GET /api/15/wallet/transactions/{id} says
// which delivery one was for. The amount on it is what was taken from the
// account, which is the order less whatever Picnic refunded for products that
// did not come and less the deposit that went back with the driver: the one
// number the delivery itself does not say. Kept free of Homey APIs so it can
// be unit tested on its own.
//
// Like the delivery, this is read behind someone's back, so an answer that is
// not what it should be is nothing rather than a failure.

function isNumber(value) {
  return typeof value == 'number' && isFinite(value);
}

function read(body) {
  if (typeof body != 'string') return body;

  try {
    return JSON.parse(body);
  } catch (exception) {
    return null;
  }
}

// Picnic counts in cents. Whether a payment is written down as a positive or
// a negative amount is not known, and the widget only says how much it was.
function euros(cents) {
  return isNumber(cents) ? Math.abs(cents) / 100 : null;
}

/**
 * The payments on the first page of the wallet, newest first.
 *
 * @param {string|Object} body the response body
 * @returns {Array|null} as [{ id, amount, status }], or null when it is not a list
 */
function parseTransactions(body) {
  const parsed = read(body);
  if (!Array.isArray(parsed)) return null;

  return parsed
    .filter(transaction => transaction && typeof transaction == 'object' && typeof transaction['id'] == 'string' && transaction['id'] != "")
    .map(transaction => ({
      "id": transaction['id'],
      "amount": euros(transaction['amount_in_cents']),
      "status": typeof transaction['status'] == 'string' ? transaction['status'] : null
    }));
}

/**
 * One payment, and the delivery it was for.
 *
 * @param {string|Object} body the response body
 * @returns {Object|null} as { deliveryId, amount, status }
 */
function parseTransaction(body) {
  const parsed = read(body);
  if (parsed === null || typeof parsed != 'object' || Array.isArray(parsed)) return null;

  const deliveryId = typeof parsed['delivery_id'] == 'string' && parsed['delivery_id'] != "" ? parsed['delivery_id'] : null;
  const amount = euros(parsed['amount_in_cents']);
  if (deliveryId === null || amount === null) return null;

  return {
    "deliveryId": deliveryId,
    "amount": amount,
    "status": typeof parsed['transaction_status'] == 'string' ? parsed['transaction_status'] : null
  };
}

module.exports = { parseTransactions, parseTransaction };
