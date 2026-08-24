'use strict';

// The decision logic behind Picnic's /api/15/deliveries/summary response and
// what the app schedules off it, kept free of Homey APIs so it can be reasoned
// about and unit tested on its own.

// The API leaves keys out when they do not apply, but has been seen to null
// them as well, so both count as "not there".
function isSet(value) {
  return value !== undefined && value !== null;
}

// delivery_time is an object with a start and an end, but accept a plain
// timestamp too so a future API change does not turn the token into "[object Object]".
function deliveryTimestamp(deliveryTime) {
  if (!isSet(deliveryTime)) return undefined;
  if (typeof deliveryTime == 'string') return deliveryTime;
  return deliveryTime["start"];
}

/**
 * Translates a summary response into the event the app should act on.
 *
 * @param {Array} summary the parsed response body
 * @param {string} previousStatus the order_status stored during the previous poll
 * @param {Object} previousEta the delivery window stored during the previous poll, as { start, end }
 * @param {string} now the moment of this poll, used when Picnic does not say when it delivered
 * @returns {Object|null} the event to handle, or null when nothing changed
 */
function deriveOrderEvent(summary, previousStatus, previousEta, now) {
  if (!Array.isArray(summary)) return null;

  const deliveredAt = now || new Date().toISOString();

  const delivery = summary[0];

  // No open delivery left, so whatever we were tracking has been delivered.
  // The summary is asked for CURRENT deliveries only, so this is the usual way
  // a delivery ends: it drops out of the response entirely and takes its
  // delivery_time with it. This poll is then the closest thing to the moment
  // it arrived that the app has.
  if (delivery == undefined) {
    if (previousStatus == "groceries_delivered") return null;
    return { "event": "groceries_delivered", "delivery_time": deliveredAt };
  }

  if (isSet(delivery["delivery_time"])) {
    if (previousStatus == "groceries_delivered") return null;
    return { "event": "groceries_delivered", "delivery_time": deliveryTimestamp(delivery["delivery_time"]) || deliveredAt };
  }

  if (isSet(delivery["eta2"])) {
    const eta2_start = delivery["eta2"]["start"];
    const eta2_end = delivery["eta2"]["end"];

    if (previousStatus != "delivery_announced") {
      return { "event": "delivery_announced", "eta2_start": eta2_start, "eta2_end": eta2_end };
    }

    // Picnic keeps refining the window while the van is on the road, so an
    // already announced delivery can still move.
    const previous = previousEta || {};
    if (eta2_start != previous["start"] || eta2_end != previous["end"]) {
      return { "event": "delivery_eta_updated", "eta2_start": eta2_start, "eta2_end": eta2_end };
    }

    return null;
  }

  if (previousStatus != "groceries_ordered") {
    const slot = delivery["slot"] || {};
    var total_amount = 0;
    (delivery["orders"] || []).forEach(function (order) { total_amount = total_amount + order["total_price"] });

    return {
      "event": "groceries_ordered",
      "price": total_amount / 100,
      "eta1_start": slot["window_start"],
      "eta1_end": slot["window_end"]
    };
  }

  return null;
}

/**
 * Whether the triggers that mark the start and the end of the announced window
 * still have something to say once the groceries have been delivered.
 *
 * They are about the window Picnic announced rather than about the van, so a
 * delivery inside the window leaves them alone. A delivery before the window
 * even starts is different: that window never became real, so marking its start
 * and end afterwards would be noise.
 *
 * @param {string} etaStart the start of the announced window
 * @param {string} deliveredAt the moment the delivery was seen, defaults to now
 * @returns {boolean}
 */
function windowTriggersStillApply(etaStart, deliveredAt) {
  // new Date(null) is the epoch rather than an invalid date, so an unset
  // setting would otherwise read as a window that started long ago
  if (typeof etaStart != 'string' || etaStart == "") return false;

  const start = new Date(etaStart);
  if (isNaN(start.getTime())) return false;

  const delivered = isSet(deliveredAt) ? new Date(deliveredAt) : new Date();
  // an unreadable delivery moment says nothing about the window, so keep what
  // was planned rather than throwing it away on a guess
  if (isNaN(delivered.getTime())) return true;

  return start <= delivered;
}

module.exports = { deriveOrderEvent, windowTriggersStillApply };
