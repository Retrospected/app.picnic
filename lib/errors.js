'use strict';

// A crash report shows the message of whatever was thrown and nothing else, so
// "an unexpected error occured" is the entire report. These say more than that.

// A failure is sometimes a string, sometimes an Error from Node carrying a code
// like ECONNREFUSED, sometimes an answer from Picnic. Say as much as it holds.
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

            // a wrapped failure already names its cause; twice is harder to read
            if (!description.includes(cause)) description += ", caused by " + cause;
        }
        return description;
    }

    try {
        // only what this value sits inside can be circular, so ancestors are
        // popped on the way back up: mentioned twice side by side is not a loop
        const ancestors = [];
        const json = JSON.stringify(error, function (key, value) {
            if (typeof value !== 'object' || value === null) return value;
            while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) ancestors.pop();
            if (ancestors.indexOf(value) !== -1) return "[circular]";
            ancestors.push(value);
            return value;
        });
        if (json !== undefined) return json;
    } catch (exception) {
        // a value that cannot be serialised still has to be described
    }

    return String(error);
}

// A value that was never an Error has no stack: say so, rather than leave the
// report looking like it was lost.
function describeStack(error) {
    if (isError(error) && typeof error.stack === 'string' && error.stack) return error.stack;
    return "no stack trace, " + describeError(error) + " was thrown as a " + typeof error;
}

// An Error keeping the original message and stack, so anything reaching the
// crash reporter has one. The context says where in the app it came from.
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

// enough of Picnic's answer to recognise it, without a page of HTML in the log
function describeBody(body) {
    const text = String(body === undefined || body === null ? "" : body).replace(/\s+/g, ' ').trim();

    if (!text) return "no answer body";
    return text.length > 200 ? text.slice(0, 200) + "..." : text;
}

function isError(value) {
    if (value instanceof Error) return true;

    // an Error from another realm fails instanceof but still looks like one
    return !!value
        && typeof value === 'object'
        && typeof value.message === 'string'
        && typeof value.name === 'string';
}

module.exports = { describeError, describeStack, describeBody, toError, isError };
