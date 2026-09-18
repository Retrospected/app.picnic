'use strict';

// What Picnic answered, in a form fit for a log: everything that says what an
// order costs or when it comes, nothing that says who it is for. Only used
// while the app runs under `homey app run` (see app.js), which is where someone
// is reading the log to find out what Picnic sends.

// Keys whose values identify a person, an account or a session.
const PRIVATE = /^(address|street|house_?number(_ext)?|postcode|zip|city|first_?name|last_?name|name_of_customer|redacted_iban|iban|bank_id|phone(_number)?|e?mail|contact_email|state_token|user_id|customer_id|household_id|payment_option_account|lat|lng|latitude|longitude|auth|token|secret|password)$/i;

// Keys that are large and say nothing about money or time.
const NOISE = /^(analytics_context_data|analytics|image_ids?|image_url|icon_url|images?|tracking|mts)$/i;

const MAX_STRING = 160;
const MAX_DEPTH = 12;

function clean(value, depth) {
  if (depth > MAX_DEPTH) return "[deeper]";
  if (typeof value == 'string') return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + "..." : value;
  if (value === null || typeof value != 'object') return value;
  if (Array.isArray(value)) return value.map(entry => clean(entry, depth + 1));

  const kept = {};

  for (const key of Object.keys(value)) {
    if (PRIVATE.test(key)) {
      kept[key] = "[private]";
    } else if (!NOISE.test(key)) {
      kept[key] = clean(value[key], depth + 1);
    }
  }

  return kept;
}

/**
 * A response body with everything private blanked and the noise left out.
 *
 * @param {string|Object} body what Picnic answered
 * @returns {string} JSON, or what could not be read as JSON, shortened
 */
function forLog(body) {
  var parsed = body;

  if (typeof body == 'string') {
    try {
      parsed = JSON.parse(body);
    } catch (exception) {
      return body.length > MAX_STRING ? body.slice(0, MAX_STRING) + "..." : body;
    }
  }

  return JSON.stringify(clean(parsed, 0));
}

module.exports = { forLog };
