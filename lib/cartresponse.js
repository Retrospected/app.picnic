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

module.exports = { parseAddProductResponse };
