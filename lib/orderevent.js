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

// Whether the app had an order in hand when this poll came back. Anything else
// - a fresh install, a sign-in on an account between deliveries, a state that
// was reset - means there is nothing for a delivery to be the end of.
function wasFollowingAnOrder(previousStatus) {
  return previousStatus == "groceries_ordered" || previousStatus == "delivery_announced";
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

  // No open delivery left. For an app that was following one, this is the
  // usual way a delivery ends: the summary is asked for CURRENT deliveries
  // only, so a delivered one drops out of the response entirely and takes its
  // delivery_time with it, and this poll is then the closest thing to the
  // moment it arrived that the app has.
  //
  // For an app that was following nothing, the very same answer means nothing
  // is going on. Reading it as a delivery is how a fresh install used to
  // announce groceries that were never ordered, to the widget and to every
  // flow on the delivered trigger.
  if (delivery == undefined) {
    if (!wasFollowingAnOrder(previousStatus)) return null;
    return { "event": "groceries_delivered", "delivery_time": deliveredAt };
  }

  if (isSet(delivery["delivery_time"])) {
    if (previousStatus == "groceries_delivered") return null;

    const arrived = deliveryTimestamp(delivery["delivery_time"]);

    // Picnic naming the moment is what makes this a delivery rather than an
    // app catching up, so without one only a followed order has delivered
    if (!isSet(arrived) && !wasFollowingAnOrder(previousStatus)) return null;

    return { "event": "groceries_delivered", "delivery_time": arrived || deliveredAt };
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

/**
 * The facts about the current delivery that do not depend on what changed
 * since the last poll, so they are read on every poll rather than off an event
 * that only fires once. Picnic leaves out what does not apply, so anything
 * missing comes back as null and leaves that part of the widget empty.
 *
 * @param {Array} summary the parsed response body
 * @returns {Object} what is known about the delivery, as { cutOffTime, deliveryId }
 */
function deriveOrderFacts(summary) {
  const nothing = { "cutOffTime": null, "deliveryId": null };

  if (!Array.isArray(summary)) return nothing;

  const delivery = summary[0];
  if (!isSet(delivery)) return nothing;

  // what the delivery can be asked about by once it has dropped out of the
  // summary, which is the moment there is most to ask: when it arrived, and
  // what came back in deposit
  const id = delivery["delivery_id"];
  const deliveryId = typeof id == 'string' && id != "" ? id : null;

  const slot = delivery["slot"];
  if (!isSet(slot)) return Object.assign({}, nothing, { "deliveryId": deliveryId });

  const cutOff = slot["cut_off_time"];

  return { "cutOffTime": typeof cutOff == 'string' && cutOff != "" ? cutOff : null, "deliveryId": deliveryId };
}

module.exports = { deriveOrderEvent, windowTriggersStillApply, deriveOrderFacts };
