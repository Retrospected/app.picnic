'use strict';

// What Picnic answers to GET /deliveries/{id}/position: where the van is on
// its route, as far as the app cares. Picnic only answers it once a van has
// been assigned, and until then with an empty body, so "no answer" is a
// state of its own here rather than a failure. The shape is the one the
// public clients model (see docs/picnic-api.md): a live window, a moment of
// arrival in milliseconds, how often to ask again, and whether the route is
// being driven right now.

function timestamp(value) {
  return typeof value == 'string' && value != "" ? value : null;
}

/**
 * @param {string|Object} body the response body
 * @returns {Object|null} { inProgress, etaStart, etaEnd, eta, queryInterval },
 *   or null when Picnic has nothing to say about the van yet
 */
function parsePosition(body) {
  var parsed = body;

  if (typeof body == 'string') {
    if (body.trim() == "") return null;

    try {
      parsed = JSON.parse(body);
    } catch (exception) {
      return null;
    }
  }

  if (parsed === null || typeof parsed != 'object' || Array.isArray(parsed)) return null;

  // an error body, or an answer without a window, says nothing about a van
  const window = parsed['eta_window'];
  if (window === null || typeof window != 'object') return null;

  return {
    // the route is being driven: the van is on its way
    "inProgress": parsed['scenario_in_progress'] === true,
    "etaStart": timestamp(window['start']),
    "etaEnd": timestamp(window['end']),
    "eta": typeof parsed['eta'] == 'number' && isFinite(parsed['eta']) ? new Date(parsed['eta']).toISOString() : null,
    // how often Picnic's own app asks again, in milliseconds
    "queryInterval": typeof parsed['query_interval'] == 'number' && parsed['query_interval'] > 0 ? parsed['query_interval'] : null
  };
}

module.exports = { parsePosition };
