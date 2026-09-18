'use strict';

// When Picnic stops letting an order be changed. Adding to an order that has
// already been placed is a thing Picnic supports right up to a deadline the
// day before the delivery: 13:00 for a delivery that starts in the morning,
// 23:00 for one in the afternoon or the evening.
//
// The API is asked for this moment first and this is what the app falls back
// on, so the rule living here is a rule about the clock rather than about
// Picnic: the times are what a Dutch account sees today and nothing guarantees
// every hub, country or slot works to them.
//
// All of it is calendar arithmetic in Homey's timezone rather than in UTC. A
// deadline of "23:00 the day before" is a time on a clock on a wall, and the
// day before a delivery is one day earlier on that wall rather than 24 hours
// earlier: twice a year those are not the same moment.

// Slots starting before this hour are the morning ones.
const MORNING_BEFORE_HOUR = 13;

const MORNING_DEADLINE_HOUR = 13;
const AFTERNOON_DEADLINE_HOUR = 23;

const DAY = 1000 * 60 * 60 * 24;

// What a clock in that timezone reads at that moment.
function localParts(instant, timezone) {
  const read = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(instant)).reduce((parts, part) => {
    parts[part.type] = part.value;
    return parts;
  }, {});

  return {
    "year": Number(read["year"]),
    "month": Number(read["month"]),
    "day": Number(read["day"]),
    "hour": Number(read["hour"]),
    "minute": Number(read["minute"]),
    "second": Number(read["second"])
  };
}

// How far that timezone is from UTC at that moment, in milliseconds.
function offsetAt(instant, timezone) {
  const local = localParts(instant, timezone);
  const asIfUtc = Date.UTC(local["year"], local["month"] - 1, local["day"], local["hour"], local["minute"], local["second"]);

  // the parts stop at whole seconds, so the instant has to as well
  return asIfUtc - (instant - (instant % 1000));
}

// The moment at which a clock in that timezone reads the given wall time.
function instantOf(wall, timezone) {
  const asIfUtc = Date.UTC(wall["year"], wall["month"] - 1, wall["day"], wall["hour"], 0, 0);

  // The offset at the answer is what is needed, and the answer is what is
  // being worked out, so the offset around the guess stands in for it. A
  // second pass settles the twice yearly case where the clock moved between
  // the two.
  const first = asIfUtc - offsetAt(asIfUtc, timezone);
  return asIfUtc - offsetAt(first, timezone);
}

/**
 * The deadline for adding to an order that is being delivered in the given
 * window, worked out from the window rather than asked for.
 *
 * @param {string} windowStart the start of the delivery window, as a timestamp
 * @param {string} timezone the timezone Homey runs in
 * @returns {string|null} the deadline as a timestamp, or null when the window says nothing
 */
function deriveCutOff(windowStart, timezone) {
  // new Date(null) is the epoch rather than an invalid date, so an unset
  // setting would otherwise produce a deadline in 1969
  if (typeof windowStart != 'string' || windowStart == "") return null;

  const start = new Date(windowStart).getTime();
  if (isNaN(start)) return null;

  try {
    const delivery = localParts(start, timezone);

    // midday on the day of the delivery, stepped back a day: far enough from
    // either end of the day that an hour moving cannot land it on the wrong one
    const midday = instantOf({ "year": delivery["year"], "month": delivery["month"], "day": delivery["day"], "hour": 12 }, timezone);
    const before = localParts(midday - DAY, timezone);

    const deadline = instantOf({
      "year": before["year"],
      "month": before["month"],
      "day": before["day"],
      "hour": delivery["hour"] < MORNING_BEFORE_HOUR ? MORNING_DEADLINE_HOUR : AFTERNOON_DEADLINE_HOUR
    }, timezone);

    return isNaN(deadline) ? null : new Date(deadline).toISOString();
  } catch (exception) {
    // a runtime that cannot work in Homey's timezone cannot work this out
    // either, and a deadline that is a guess is worse than none
    return null;
  }
}

module.exports = { deriveCutOff };
