'use strict';

// Picnic hands out timestamps with a local offset today, so slicing the string
// apart happened to produce the right time. Nothing guarantees that stays true:
// the moment the API sends a UTC timestamp, the tokens would show a different
// time than the one the app schedules its jobs on. Parsing to a Date and
// formatting in Homey's own timezone keeps the two in sync either way.

function formatParts(iso, timezone, options) {
  // new Date(null) is the epoch rather than an invalid date, so an unset
  // setting would silently format as 1 jan 1970
  if (typeof iso != 'string' || iso == "") return null;

  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;

  const formatted = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: timezone || undefined }, options)).formatToParts(date);

  return formatted.reduce((parts, part) => {
    parts[part.type] = part.value;
    return parts;
  }, {});
}

// How this app used to format its timestamps. Only reached on a runtime that
// cannot resolve Homey's timezone, which would otherwise leave a token empty.
function legacyParts(iso) {
  if (typeof iso != 'string') return null;

  const cleaned = iso.replace(/T/, ' ').replace(/\..+/, '').split(' ');
  return { "date": cleaned[0] || "", "time": cleaned[1] ? cleaned[1].slice(0, -3) : "" };
}

/**
 * Formats a timestamp as HH:mm in the given timezone, e.g. "16:11".
 */
function formatEtaTime(iso, timezone) {
  try {
    const parts = formatParts(iso, timezone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    if (parts !== null) return parts["hour"] + ":" + parts["minute"];
  } catch (exception) {
    // fall through to the legacy format below
  }

  const legacy = legacyParts(iso);
  return legacy === null ? "" : legacy["time"];
}

/**
 * Formats a timestamp as YYYY-MM-DD in the given timezone, e.g. "2026-07-28".
 */
function formatEtaDate(iso, timezone) {
  try {
    const parts = formatParts(iso, timezone, { year: 'numeric', month: '2-digit', day: '2-digit' });
    if (parts !== null) return parts["year"] + "-" + parts["month"] + "-" + parts["day"];
  } catch (exception) {
    // fall through to the legacy format below
  }

  const legacy = legacyParts(iso);
  return legacy === null ? "" : legacy["date"];
}

module.exports = { formatEtaTime, formatEtaDate };
