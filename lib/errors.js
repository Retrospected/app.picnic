'use strict';

// A crash report shows the message of whatever was thrown and nothing else, so
// "an unexpected error occured" is the entire report. These helpers turn any
// thrown value into one line that says what kind of failure it was, what it
// said, and what caused it, so a report points at something.

// Errors travelling through the app are sometimes plain strings, sometimes
// Error objects from Node (which carry a code like ECONNREFUSED) and sometimes
// responses from Picnic. Whatever it is, say as much about it as it holds.
function describeError(error, seen) {
    seen = seen || new Set();

    if (error === undefined) return "undefined";
    if (error === null) return "null";
    if (typeof error === 'string') return error || "an empty message";
    if (typeof error !== 'object') return String(error);
    if (seen.has(error)) return "[circular]";

    seen.add(error);

    if (isError(error)) {
        let description = (error.name || "Error");
        if (error.message) description += ": " + error.message;
        if (error.code !== undefined) description += " (code " + error.code + ")";
        if (error.statusCode !== undefined) description += " (HTTP " + error.statusCode + ")";
        if (error.cause !== undefined && error.cause !== null) {
            const cause = describeError(error.cause, seen);

            // a failure wrapped in context already says what caused it, and
            // saying it twice makes the line harder to read rather than fuller
            if (!description.includes(cause)) description += ", caused by " + cause;
        }
        return description;
    }

    try {
        // a value that refers to itself would otherwise not serialise at all,
        // and "[object Object]" is no better than the message it replaces
        const nested = new Set();
        const json = JSON.stringify(error, (key, value) => {
            if (typeof value !== 'object' || value === null) return value;
            if (nested.has(value)) return "[circular]";
            nested.add(value);
            return value;
        });
        if (json !== undefined) return json;
    } catch (exception) {
        // a value that cannot be serialised still has to be described
    }

    return String(error);
}

// Every line of the stack matters when the report is all there is, but a value
// that was never an Error has none: say so rather than leaving the report to
// suggest the stack was lost.
function describeStack(error) {
    if (isError(error) && typeof error.stack === 'string' && error.stack) return error.stack;
    return "no stack trace, " + describeError(error) + " was thrown as a " + typeof error;
}

// An Error that keeps the original message and stack, so a value that reaches
// the crash reporter always arrives as something with a stack in it. The
// context says where in the app the failure came from, which is the part a
// report can never recover by itself.
function toError(value, context) {
    const prefix = context ? context + ": " : "";

    if (isError(value)) {
        if (!context || String(value.message).startsWith(context)) return value;

        const wrapped = new Error(prefix + describeError(value));
        wrapped.cause = value;
        wrapped.stack = wrapped.stack + "\nCaused by: " + describeStack(value);
        return wrapped;
    }

    return new Error(prefix + describeError(value));
}

// Enough of an answer from Picnic to recognise it in a report, without putting
// a whole page of HTML in the log.
function describeBody(body) {
    const text = String(body === undefined || body === null ? "" : body).replace(/\s+/g, ' ').trim();

    if (!text) return "no answer body";
    return text.length > 200 ? text.slice(0, 200) + "..." : text;
}

function isError(value) {
    if (value instanceof Error) return true;

    // an Error crossing a realm boundary fails instanceof, but still looks
    // exactly like one
    return !!value
        && typeof value === 'object'
        && typeof value.message === 'string'
        && typeof value.name === 'string';
}

module.exports = { describeError, describeStack, describeBody, toError, isError };
