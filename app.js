'use strict';

const Homey = require('homey');
const actions = require('./lib/actions.js');
const conditions = require('./lib/conditions.js')
const utils = require('./lib/utils.js');
const { deriveOrderEvent, windowTriggersStillApply, deriveOrderFacts } = require('./lib/orderevent.js');
const { deriveDeliveryState, orderCheckDue } = require('./lib/deliverystate.js');
const { parseCart } = require('./lib/cartresponse.js');
const { parsePosition } = require('./lib/positionresponse.js');

// How long before its window a delivery is watched for the van leaving, and
// how often while it is. Picnic's own app asks every ten seconds once the van
// is on the road; a dashboard read in passing does not need to know that
// closely, and asking every minute keeps the app a polite guest.
const POSITION_LOOKOUT = 3 * 60 * 60 * 1000;
const POSITION_MAX_AGE = 60 * 1000;
const { parseDelivery } = require('./lib/deliveryresponse.js');
const { parseTransactions, parseTransaction } = require('./lib/walletresponse.js');
const cutoff = require('./lib/cutoff.js');
const { PICNIC_AGENT, PICNIC_DID } = require('./lib/picnicheaders.js');
const twofactor = require('./lib/twofactor.js');
const { describeError, describeStack, describeBody, toError } = require('./lib/errors.js');
const { refusal, hasCode, SECOND_FACTOR_REQUIRED } = require('./lib/refusal.js');
const { forLog } = require('./lib/debuglog.js');
const eta = require('./lib/eta.js');

var http = require("https");
var md5 = require("md5");
const schedule = require('node-schedule');

var DEFAULT_POLL_INTERVAL = 1000 * 60 * 60 * 6 // 6 hours
var ORDERED_POLL_INTERVAL = 1000 * 60 * 60 * 1 // 1 hour
var DELIVERY_POLL_INTERVAL = 1000 * 60 * 1 // 1 minute

// How long the cart the widget shows may be out of date. It is only ever
// fetched because a dashboard is asking, so this is about how often someone
// watching one has Picnic asked on their behalf, not about a timer.
const CART_MAX_AGE = 1000 * 60 * 5 // 5 minutes

// How long what Picnic said about a delivery that has been made may be out of
// date. Only asked for while the widget shows that delivery, which is a few
// hours, and the deposit coming back is the one thing in it that changes.
const DELIVERY_MAX_AGE = 1000 * 60 * 10 // 10 minutes

// How old the cart and the orders may be when a widget asks for them fresh:
// one that just came into view, or that someone tapped. It is also how often
// that gets to have Picnic asked, however many dashboards and taps there are.
const FRESH_MAX_AGE = 1000 * 30 // 30 seconds

// How long an answer asked for fresh waits for Picnic. Whatever comes later
// is pushed to the widget like any other change.
const FRESH_WAIT = 1000 * 4 // 4 seconds

// How many of the newest payments are asked about to find the one for a
// delivery that was just made. The wallet does not say which delivery a
// payment was for until each is asked about, and the one wanted is the latest
// or close to it.
const WALLET_LOOKBACK = 3

const DEBUG = false

// Homey sets this for an app started with `homey app run` and for no other, so
// what Picnic answers is written to the log while someone is developing
// against it, and never by an installed app.
const LOG_RESPONSES = process.env.DEBUG === '1'

var runningInterval;
var failureHandlers = null;

class Picnic extends Homey.App {

	onInit() {
		this.homey.log('Picnic is running...')

		this._logUnexpectedFailures();

		if (DEBUG) {
			this.debug('DEBUG ENABLED')
			DEFAULT_POLL_INTERVAL = 1000 * 60 * 1 // 1 minute
			ORDERED_POLL_INTERVAL = 1000 * 30 * 1 // 30 seconds
			DELIVERY_POLL_INTERVAL = 1000 * 10 * 1 // 10 seconds

			this.debug("ORDER STATUS: " + this.homey.settings.get("order_status"))
			this.debug("PICNIC USER: " + this.homey.settings.get("username"))
			//this.debug("PICNIC PASS: "+this.homey.settings.get("password"))
			//this.debug("PICNIC JWT: "+this.homey.settings.get("x-picnic-auth"))
		}

		this.actions = new actions({ homey: this.homey });
		this.actions.onInit();

		this.conditions = new conditions({ homey: this.homey });
		this.conditions.onInit();

		this.utils = new utils({ homey: this.homey });

		this._deliveryWindowJobs = [];
		this._deliverySoonJobs = [];
		this._pollRateJobs = [];

		this.homey.settings.set("additemLock", false)

		// simulate fresh install
		// this.homey.settings.unset("order_status")
		// this.homey.settings.unset("delivery_eta_start")
		// this.homey.settings.unset("x-picnic-auth")
		// this.homey.settings.unset("x-picnic-auth-pending")
		// this.homey.settings.unset("2fa_pending")
		// this.homey.settings.unset("username")
		// this.homey.settings.unset("password")
		// this.homey.settings.set("order_status", "delivery_announced")

		// conversion order_status code for all versions before 3.2.1
		// this prevents unnecessary triggers being fired when <3.2.1 is upgraded to 3.2.2 and above
		if (this.homey.settings.get("order_status") == "order_announced") {
			this.homey.settings.set("order_status", "delivery_announced");
		} else if (this.homey.settings.get("order_status") == "order_delivered") {
			this.homey.settings.set("order_status", "groceries_delivered");
		} else if (this.homey.settings.get("order_status") == "order_placed") {
			this.homey.settings.set("order_status", "groceries_ordered");
		}

		this._initFlowTriggers();
		this._initAppTokens();
		this._initTimers();

		// retrieve initial order info

		if (this.homey.settings.getKeys().indexOf("country") == -1) {
			this.debug("No country set, setting default to NL.")
			this.homey.settings.set("country", "nl")
		}

		this.setUrl()

		this.logState("State at startup")

		if (this.homey.settings.getKeys().indexOf("x-picnic-auth") != -1) {
			this.debug("Auth found, retrieving order")
			this.pollOrder();
		}
	}

	async onUninit() {
		this.info("Picnic is stopping, cleaning up the timers")
		this.cancelDeliverySchedule();
		clearInterval(runningInterval);
	}

	async _initAppTokens() {

		// Create app tokens (labels)
		let orderStatus = await this.homey.flow.createToken('order_status', {
			type: 'string',
			title: this.homey.__('tokens.order.status')
		});

		let orderPrice = await this.homey.flow.createToken('order_price', {
			type: 'number',
			title: this.homey.__('tokens.order.price')
		});

		let orderDeliveryDate = await this.homey.flow.createToken('order_deliverydate', {
			type: 'string',
			title: this.homey.__('tokens.delivery.date')
		});

		let orderDeliveryStartWindow = await this.homey.flow.createToken('order_deliverystartwindow', {
			type: 'string',
			title: this.homey.__('tokens.delivery.startwindow')
		});

		let orderDeliveryEndWindow = await this.homey.flow.createToken('order_deliveryendwindow', {
			type: 'string',
			title: this.homey.__('tokens.delivery.endwindow')
		});

		this.orderStatus = orderStatus;
		this.orderPrice = orderPrice;
		this.orderDeliveryDate = orderDeliveryDate;
		this.orderDeliveryStartWindow = orderDeliveryStartWindow;
		this.orderDeliveryEndWindow = orderDeliveryEndWindow;

		if (this.homey.settings.get("order_status") !== null) {
			await this.orderStatus.setValue(this.homey.settings.get("order_status"));
		} else {
			await this.orderStatus.setValue("")
		}

		if (this.homey.settings.get("order_price") !== null) {
			await this.orderPrice.setValue(this.homey.settings.get("order_price"));
		} else {
			await this.orderPrice.setValue(0)
		}

		if (this.homey.settings.get("delivery_date") !== null) {
			await this.orderDeliveryDate.setValue(this.homey.settings.get("delivery_date"));
		} else {
			await this.orderDeliveryDate.setValue("")
		}

		if (this.homey.settings.get("delivery_eta_start") !== null) {
			await this.orderDeliveryStartWindow.setValue(this.formatEtaTime(this.homey.settings.get("delivery_eta_start")));
		} else {
			await this.orderDeliveryStartWindow.setValue("")
		}

		if (this.homey.settings.get("delivery_eta_end") !== null) {
			await this.orderDeliveryEndWindow.setValue(this.formatEtaTime(this.homey.settings.get("delivery_eta_end")));
		} else {
			await this.orderDeliveryEndWindow.setValue("")
		}
	}

	async _initFlowTriggers() {
		this.homey.app.debug("INIT Triggers")

		this._groceriesOrderedTrigger = this.homey.flow
			.getTriggerCard('groceries_ordered')
			.registerRunListener();
		this._deliveryAnnouncedTrigger = this.homey.flow
			.getTriggerCard('delivery_announced')
			.registerRunListener();

		this._deliverySoonTrigger = this.homey.flow
			.getTriggerCard('delivery_soon')
			.registerRunListener((args, state) => args.minutes === state.minutes);

		// fired when a flow using this card is saved
		this._deliverySoonTrigger.on('update', () => {
			this.rescheduleDeliverySoon().catch(error => this.homey.error(error));
		});

		this._groceriesDelivered = this.homey.flow
			.getTriggerCard('groceries_delivered')
			.registerRunListener();

		this._deliveryAnnouncedTriggerBeginTime = this.homey.flow
			.getTriggerCard('delivery_announced_begin_time')
			.registerRunListener();

		this._deliveryAnnouncedTriggerEndTime = this.homey.flow
			.getTriggerCard('delivery_announced_end_time')
			.registerRunListener();
	}

	async _initTimers() {
		// start relevant interval
		if (this.homey.settings.get("order_status") == "groceries_ordered") {
			this.debug("Order found, updating poll interval")
			this.homey.app.changeInterval(ORDERED_POLL_INTERVAL);
		}
		else if (this.homey.settings.get("order_status") == "delivery_announced") {
			this.debug("Order announced")

			const settingKeys = this.homey.settings.getKeys();

			// without both ends of the window new Date(null) would schedule for
			// 1 jan 1970, so check for the end as well as the start
			if (settingKeys.indexOf("delivery_eta_start") != -1 && settingKeys.indexOf("delivery_eta_end") != -1) {
				this.debug("Rescheduling the jobs for the delivery window we know about");
				await this.homey.app.createDeliverySchedule(this.homey.settings.get("delivery_eta_start"), this.homey.settings.get("delivery_eta_end"));
			} else {
				this.debug("No delivery window stored, using ORDERED interval");
				this.homey.app.changeInterval(ORDERED_POLL_INTERVAL);
			}
		}
		else if (this.homey.settings.get("order_status") == "groceries_delivered") {
			this.debug("No order found, updating poll interval")
			this.homey.app.changeInterval(DEFAULT_POLL_INTERVAL);
		}
	}

	// Always logged, unlike debug(): these are the lines a diagnostic report
	// needs to explain what the app was doing and what state it was in.
	info(message) {
		try {
			this.homey.log(message);
		} catch (exception) {
			this.homey.error(exception);
		}
	}

	// Polling runs as often as every minute, so a failure that keeps happening
	// is logged when it starts and once more when it clears, rather than on
	// every attempt: a report should show a problem, not be buried in it.
	_logProblem(subject, problem) {
		if (this._problems === undefined) this._problems = {};

		const previous = this._problems[subject];

		if (previous === problem) return false;
		if (previous === undefined && !problem) {
			this._problems[subject] = problem;
			return false;
		}

		this._problems[subject] = problem;
		this.info(problem ? subject + " failed: " + problem : subject + " works again");
		return true;
	}

	// A rejected promise nobody awaits takes the app down with only its message
	// as the report. Log it first, and pass on a real Error so it has a stack.
	_logUnexpectedFailures() {
		// the handlers outlive the app object, so a restart would stack a second set
		this._removeFailureHandlers();

		failureHandlers = {
			rejection: (reason) => {
				const crash = toError(reason, "Unhandled rejection");

				this._logCrash("A failure nobody handled took the app down", reason);

				// the crash below should not be logged a second time
				this._markCrashLogged(crash);
				this._crash(crash);
			},
			exception: (exception) => {
				this._logCrash("The app crashed", exception);
				this._crash(exception);
			}
		};

		process.on('unhandledRejection', failureHandlers.rejection);
		process.on('uncaughtException', failureHandlers.exception);
	}

	// Throwing from inside a handler skips the listeners after it and exits with
	// 7 rather than 1, so step out of the handler with ours removed.
	_crash(error) {
		this._removeFailureHandlers();
		setImmediate(() => { throw error; });
	}

	_removeFailureHandlers() {
		if (failureHandlers === null) return;

		process.off('unhandledRejection', failureHandlers.rejection);
		process.off('uncaughtException', failureHandlers.exception);
		failureHandlers = null;
	}

	// what a crash message cannot hold: where it came from and the state it left
	_logCrash(heading, error) {
		if (this._markCrashLogged(error) === false) return;

		this.info(heading + ": " + describeError(error));
		this.info(heading + ", it came from: " + describeStack(error));

		try {
			this.logState("State when the app crashed");
		} catch (exception) {
			this.info("The state at the crash could not be read: " + describeError(exception));
		}
	}

	// Whether this failure is new. One that cannot be remembered counts as new:
	// logging a crash twice beats not logging it at all.
	_markCrashLogged(error) {
		// weak: the app runs on past the failures logged here, keeping them all leaks
		if (this._crashLogged === undefined) this._crashLogged = new WeakSet();

		// the wrapper around a failure and the failure itself are one crash
		const value = error && error.cause !== undefined && error.cause !== null ? error.cause : error;

		if (typeof value !== 'object' || value === null) return true;
		if (this._crashLogged.has(value)) return false;

		this._crashLogged.add(value);
		return true;
	}

	// One snapshot of everything that decides what the app does next. No
	// username, password or token: whether they are stored is what matters and
	// a report is read by someone other than the user.
	logState(reason) {
		const stored = (key) => !!this.homey.settings.get(key);
		const or = (key, fallback) => this.homey.settings.get(key) || fallback;

		this.info(reason + ": version " + ((this.homey.manifest && this.homey.manifest.version) || "unknown")
			+ ", country " + or("country", "unset")
			+ ", endpoint " + or("url", "unset"));

		this.info(reason + ": username " + (stored("username") ? "stored" : "missing")
			+ ", password " + (stored("password") ? "stored" : "missing")
			+ ", auth token " + (stored("x-picnic-auth") ? "stored" : "missing")
			+ (stored("x-picnic-auth-pending") || this.homey.settings.get("2fa_pending") === true
				? ", a 2FA code is still waiting to be verified" : "")
			+ (this.homey.settings.get("2fa_signin_required") === true
				? ", and Picnic wants a 2FA code that only a sign-in asks for" : ""));

		this.info(reason + ": order status " + or("order_status", "unknown")
			+ ", delivery window " + or("delivery_eta_start", "unknown") + " until " + or("delivery_eta_end", "unknown"));
	}

	// What Picnic answered, private details blanked, for `make run` only.
	_logResponse(subject, body) {
		if (!LOG_RESPONSES) return;
		this.info("Picnic answered " + subject + ": " + forLog(body));
	}

	debug(message) {
		try {
			if (DEBUG) {
				const debugMessage = `[debug] ${message}`;
				this.homey.log(debugMessage);
			}
		} catch (exception) {
			this.homey.error(exception);
		}

	}

	formatEtaTime(iso) {
		return eta.formatEtaTime(iso, this.homey.clock.getTimezone());
	}

	formatEtaDate(iso) {
		return eta.formatEtaDate(iso, this.homey.clock.getTimezone());
	}

	// The deadline for adding to an order being delivered in this window. A
	// deadline of "the day before" is a day on a calendar in Homey's timezone
	// rather than a number of hours, so the timezone goes with it.
	cutOffFor(windowStart) {
		return cutoff.deriveCutOff(windowStart, this.homey.clock.getTimezone());
	}

	// the token set every delivery window trigger hands to its flow
	_etaTokens(eta_start, eta_end) {
		return {
			'eta_start': this.formatEtaTime(eta_start),
			'eta_end': this.formatEtaTime(eta_end),
			'eta_date': this.formatEtaDate(eta_start)
		}
	}

	// Everything the dashboard widget draws, in the terms it draws it in. The
	// widget ticks its own countdown down between polls, so it is handed the
	// moment Homey thinks it is now as well: a tablet whose clock runs a few
	// minutes off would otherwise count down to the wrong minute.
	async getDeliveryWidgetState() {
		const now = new Date();
		const deliveryId = this.homey.settings.get("delivery_id");

		const state = deriveDeliveryState({
			"orderStatus": this.homey.settings.get("order_status"),
			"etaStart": this.homey.settings.get("delivery_eta_start"),
			"etaEnd": this.homey.settings.get("delivery_eta_end"),
			// where the van is, as far as Picnic has said so for this delivery
			"position": this._position && this._position["deliveryId"] == deliveryId ? this._position : null,
			"underwayAt": this.homey.settings.get("delivery_underway_at"),
			"deliveredAt": this.homey.settings.get("delivery_time"),
			// what Picnic said, and otherwise what its own rule works out to: an
			// order can be added to until 13:00 the day before a delivery that
			// starts in the morning, and until 23:00 the day before one later
			"cutOffAt": this.homey.settings.get("delivery_cut_off")
				|| this.cutOffFor(this.homey.settings.get("delivery_eta_start")),
			"signInNeeded": this._picnicOutOfReach(),
			"checkedAt": this.homey.settings.get("order_checked_at"),
			"cart": this._cart || null,
			// only what was asked about the delivery the app is following: the
			// details of the one before it would be about other groceries
			"delivery": this._delivery && this._delivery["deliveryId"] == deliveryId ? this._delivery : null,
			"now": now.toISOString()
		});

		// The cart is worth a look when nothing is planned, and while an order
		// is still open, because what is in it then are the things that have yet
		// to be added to that order. Once it closes Picnic is left alone about it.
		if (state["state"] == "empty" || state["state"] == "cart" || state["cutOffAt"]) this._refreshCartWhenStale();

		// A delivery that has been made is asked about while it is on the
		// dashboard: when it really arrived, and what came back in deposit.
		// The order in full is asked for while one is placed or has just been
		// delivered: how many products it holds, what it costs once something
		// has been added to it, and once delivered, when it came and what came
		// back in deposit. The summary the poll reads carries none of that.
		const orderInHand = ["ordered", "announced", "underway", "arriving", "overdue", "delivered"].indexOf(state["state"]) != -1;
		if (orderInHand && deliveryId) this._refreshDeliveryWhenStale(deliveryId);

		// What was taken from the account for a delivery is only in the wallet,
		// once Picnic has settled it: the order less what it refunded and less
		// the deposit that went back.
		if (state["state"] == "delivered" && deliveryId) this._refreshChargeWhenStale(deliveryId);

		// The window Picnic announces is a plan, made the day before; the van
		// leaving is what makes a delivery "on its way", and Picnic only says
		// where the van is once there is one. From a few hours before the
		// window, while a dashboard is looking, it is asked.
		const windowStart = Date.parse(state["etaStart"]);
		const vanDue = ["announced", "underway", "arriving", "overdue"].indexOf(state["state"]) != -1
			&& !isNaN(windowStart) && windowStart - now.getTime() <= POSITION_LOOKOUT;
		if (vanDue && deliveryId) this._refreshPositionWhenStale(deliveryId);

		// Between deliveries the poll runs every six hours, which is how an
		// order placed in the Picnic app went unnoticed until long after its
		// deadline to add to it. While a dashboard is looking, Picnic is asked
		// about orders as often as it is asked about the cart.
		if (orderCheckDue(state["state"], this.homey.settings.get("order_checked_at"), now.getTime(), false)) this._refreshOrder();

		const cart = state["cart"];
		const slot = cart && cart["slot"];
		const next = state["nextSlots"];
		const delivery = state["delivery"];
		const details = this._delivery && this._delivery["deliveryId"] == deliveryId ? this._delivery : null;
		const orderPrice = this.homey.settings.get("order_price");
		const charged = this._charge && this._charge["deliveryId"] == deliveryId ? this._charge["amount"] : null;

		// what the order in full says it costs when that is known: adding to
		// an order places a second one in the same delivery, which the price
		// stored when the first was placed knows nothing about
		const ordered = details && details["totalPrice"] !== null ? details["totalPrice"] : (typeof orderPrice == 'number' ? orderPrice : null);

		// Formatted here rather than in the widget: the times belong to the
		// timezone Homey runs in, not to the one the browser showing the
		// dashboard happens to be in.
		return {
			"state": state["state"],
			"now": now.toISOString(),
			"countdownTo": state["countdownTo"],
			"progress": state["progress"],
			"day": this.formatEtaDay(state["etaStart"] || state["deliveredAt"], now),
			"window": this._formatWindow(state["etaStart"], state["etaEnd"]),
			// the end of the window, for saying how far past it a late delivery is
			"windowEnd": state["etaEnd"],
			"deliveredTime": this.formatEtaTime(state["deliveredAt"]),
			"cutOffAt": state["cutOffAt"],
			"cutOffLabel": this._formatMoment(state["cutOffAt"], now),
			// the price of an order the widget is not showing would be read as
			// the price of whatever it is showing instead
			"price": !orderInHand ? null
				: (state["state"] == "delivered" ? this._settledPrice(ordered, charged, delivery) : ordered),
			"orderCount": orderInHand && details ? details["productCount"] : null,
			"deposit": delivery ? {
				"returned": delivery["depositReturned"],
				"containers": delivery["returned"].map(container => ({ "name": container["name"], "quantity": container["quantity"] }))
			} : null,
			"cart": cart ? {
				"totalPrice": cart["totalPrice"],
				"productCount": cart["productCount"],
				"minimumShort": cart["minimumShort"],
				"slotChosen": cart["slotChosen"],
				"slotClosed": cart["slotClosed"],
				"slot": slot ? {
					"day": this.formatEtaDay(slot["windowStart"], now),
					"window": this._formatWindow(slot["windowStart"], slot["windowEnd"]),
					"cutOffAt": slot["cutOffAt"],
					"cutOffTime": this.formatEtaTime(slot["cutOffAt"]),
					"cutOffDay": this.formatEtaDay(slot["cutOffAt"], now),
					"cutOffLabel": this._formatMoment(slot["cutOffAt"], now)
				} : null
			} : null,
			"cartKnown": state["cartKnown"],
			// the slot picked for a cart that is still empty
			"chosenSlot": state["chosenSlot"] ? {
				"day": this.formatEtaDay(state["chosenSlot"]["windowStart"], now),
				"window": this._formatWindow(state["chosenSlot"]["windowStart"], state["chosenSlot"]["windowEnd"]),
				"cutOffAt": state["chosenSlot"]["cutOffAt"],
				"cutOffTime": this.formatEtaTime(state["chosenSlot"]["cutOffAt"]),
				"cutOffDay": this.formatEtaDay(state["chosenSlot"]["cutOffAt"], now),
				"cutOffLabel": this._formatMoment(state["chosenSlot"]["cutOffAt"], now)
			} : null,
			// the next day something can be delivered on: how many of its slots
			// are still open, and when the first of those is, from and until
			"nextSlots": next ? {
				"day": this.formatEtaDay(next["windowStart"], now),
				"time": this.formatEtaTime(next["windowStart"]),
				"window": this._formatWindow(next["windowStart"], next["windowEnd"]),
				"available": next["available"],
				"total": next["total"]
			} : null,
			"checkedLabel": this._formatMoment(state["checkedAt"], now),
			// amounts are written the way Homey's language writes them, not the
			// way the tablet showing the dashboard happens to be set up
			"locale": this._language(),
			"labels": this._deliveryWidgetLabels()
		};
	}

	// Everything the widget draws, as fresh as Picnic can make it, for a widget
	// that has just come into view or that someone tapped: the cart and the
	// orders are asked about unless that was done in the last half minute. A
	// cart filled in Picnic's app a minute ago would otherwise wait up to five
	// for the widget to see it.
	async refreshDeliveryWidgetState() {
		const before = await this.getDeliveryWidgetState();
		const asked = [];

		if (before["state"] == "empty" || before["state"] == "cart" || before["cutOffAt"]) {
			asked.push(this._refreshCartWhenStale(FRESH_MAX_AGE));
		}

		if (orderCheckDue(before["state"], this.homey.settings.get("order_checked_at"), Date.now(), false, FRESH_MAX_AGE)) {
			asked.push(this._refreshOrder());
		}

		const pending = asked.filter(Boolean);

		if (pending.length > 0) {
			var timer = null;
			const waited = new Promise(resolve => { timer = setTimeout(resolve, FRESH_WAIT); });

			await Promise.race([Promise.all(pending), waited]);
			clearTimeout(timer);
		}

		return await this.getDeliveryWidgetState();
	}

	// What a delivery comes to once it has been made: what the wallet says was
	// taken from the account when Picnic has settled it, and until then the
	// order less the deposit that went back, once that has been counted. What
	// Picnic refunds for products that did not come is only in the wallet.
	_settledPrice(ordered, charged, delivery) {
		if (charged !== null) return charged;
		if (ordered === null) return null;

		const returned = delivery && typeof delivery["depositReturned"] == 'number' ? delivery["depositReturned"] : 0;
		return Math.round((ordered - returned) * 100) / 100;
	}

	_language() {
		try {
			return this.homey.i18n.getLanguage() || undefined;
		} catch (exception) {
			return undefined;
		}
	}

	// "16:11–16:31", or as much of it as is known
	_formatWindow(start, end) {
		const from = this.formatEtaTime(start);
		const until = this.formatEtaTime(end);

		if (from == "" || until == "") return from;
		return from + "–" + until;
	}

	// "today 23:00", "Fri 19 Sep 13:00": a moment someone has to act before,
	// which is always worth its day as well as its time
	_formatMoment(iso, now) {
		const day = this.formatEtaDay(iso, now);
		const time = this.formatEtaTime(iso);

		if (day == "" || time == "") return time;
		return day + " " + time;
	}

	// Whether the app is in a position to know anything about an order at all.
	// Not to be confused with _signInRequired(), which puts it in that position.
	_picnicOutOfReach() {
		if (this.homey.settings.get("2fa_signin_required") === true) return true;

		return !this.homey.settings.get("username") || !this.homey.settings.get("password");
	}

	// The day a delivery falls on, as someone glancing at a dashboard reads it:
	// the ones they can plan around by name, and a date for the rest.
	formatEtaDay(iso, now) {
		const date = this.formatEtaDate(iso);
		if (date == "") return "";

		const today = now || new Date();
		const tomorrow = new Date(today.getTime() + 1000 * 60 * 60 * 24);

		if (date == this.formatEtaDate(today.toISOString())) return this.homey.__("widget.delivery.today");
		if (date == this.formatEtaDate(tomorrow.toISOString())) return this.homey.__("widget.delivery.tomorrow");

		try {
			return new Intl.DateTimeFormat(this.homey.i18n.getLanguage(), {
				timeZone: this.homey.clock.getTimezone() || undefined,
				weekday: 'short',
				day: 'numeric',
				month: 'short'
			}).format(new Date(iso));
		} catch (exception) {
			// a runtime that cannot name the day can still name the date
			return date;
		}
	}

	// The words the widget puts on the screen. They are handed over rather than
	// translated in the widget because the countdown is retold every few seconds
	// while the app is not asked anything, so the widget needs the sentence
	// before it has the number to put in it. __n__ is what it fills in.
	_deliveryWidgetLabels() {
		const labels = {};

		["signed-out", "signed-out-detail", "stale", "stale-since", "empty", "empty-cart",
			"ordered", "ordered-short", "underway", "arriving", "overdue", "delivered", "delivered-caption",
			"now", "delivery-in", "today", "day", "days", "hour", "hours", "minute", "minutes",
			"cart", "item", "items", "minimum", "minimum-caption", "pick-slot", "slot-closed",
			"order-before", "order-within", "order-before-short", "order-within-short",
			"cut-off-at", "cut-off-in", "cut-off-in-one", "cut-off-in-short",
			"to-order-item", "to-order-items", "to-order-at", "to-order-in", "to-order-in-one",
			"to-order-short-at", "to-order-short-in", "cart-amount",
			"next-slots", "next-slots-first", "next-slots-first-window", "next-slots-short", "next-slots-short-first",
			"chosen-slot", "chosen-slot-before", "chosen-slot-within",
			"late-by", "late-by-one", "late-short",
			"deposit-returned", "deposit-pending"].forEach(key => {
				labels[key] = this.homey.__("widget.delivery." + key);
			});

		return labels;
	}

	// The moment after which Picnic will not let this order be changed any
	// more. Kept out of the event machinery on purpose: it is a fact about the
	// slot rather than something that happened, and an order that was already
	// open when this app version arrived has to pick it up too.
	_storeOrderFacts(facts) {
		const cutOff = facts["cutOffTime"];

		if (cutOff) {
			this.homey.settings.set("delivery_cut_off", cutOff);
		} else {
			this.homey.settings.unset("delivery_cut_off");
		}

		// Kept when the delivery drops out of the summary, which is exactly
		// when it is needed: that is how a delivery ends.
		if (facts["deliveryId"]) this.homey.settings.set("delivery_id", facts["deliveryId"]);
	}

	// Where the van is, as far as the widget is concerned: in memory like the
	// cart, and for the same reason. The moment the van was first seen on the
	// road is the one thing written down, so the bar that fills from it
	// survives a restart mid-route.
	_refreshPositionWhenStale(deliveryId) {
		if (this._positionRefreshing === true) return;
		if (this._position && this._position["deliveryId"] == deliveryId && Date.now() - this._position["refreshedAt"] < POSITION_MAX_AGE) return;
		if (!this.homey.settings.get("x-picnic-auth") || this._picnicOutOfReach()) return;

		this._positionRefreshing = true;

		this.utils.getDeliveryPosition(deliveryId)
			.then(body => {
				this._logResponse("GET /api/15/deliveries/{id}/position", body);

				// nothing said yet is a van that has not left: not a failure
				const position = parsePosition(body);
				const before = this._position && this._position["deliveryId"] == deliveryId ? this._position["inProgress"] : false;

				this._position = Object.assign({ "deliveryId": deliveryId, "refreshedAt": Date.now(), "inProgress": false }, position || {});

				if (this._position["inProgress"] && !this.homey.settings.get("delivery_underway_at")) {
					this.homey.settings.set("delivery_underway_at", new Date().toISOString());
				}

				if (this._position["inProgress"] && !before) {
					this.info("Picnic says the van is on its way, expected between " + this._position["etaStart"] + " and " + this._position["etaEnd"]);
				}

				return this._publishDeliveryState();
			})
			.catch(async error => {
				if (hasCode(error, SECOND_FACTOR_REQUIRED)) return await this._signInRequired();

				// the widget goes on showing the pending order, which is true as
				// far as the app knows
				this.error(error);
			})
			.finally(() => {
				this._positionRefreshing = false;
			});
	}

	// The cart, as far as the widget is concerned. Kept in memory rather than
	// in the settings: it is a copy of something Picnic owns, and a stale one
	// surviving a restart would be worse than not having it at all.
	//
	// Answers with the request that is under way, for anyone who wants to wait
	// for it, or with null when none is.
	_refreshCartWhenStale(maxAge) {
		if (this._cartRefreshing) return this._cartRefreshing;
		if (this._cart !== undefined && this._cart !== null && Date.now() - this._cart["refreshedAt"] < (maxAge === undefined ? CART_MAX_AGE : maxAge)) return null;

		// no token, or a sign-in Picnic is waiting for: asking would only
		// produce the failure the settings page already reports
		if (!this.homey.settings.get("x-picnic-auth") || this._picnicOutOfReach()) return null;

		// deliberately not awaited here: the widget is waiting for an answer,
		// and the cart it does not have yet is worth less than a fast one.
		// What comes back is pushed to it the same way any other change is.
		this._cartRefreshing = this.utils.getCart()
			.then(body => {
				this._logResponse("GET /api/15/cart", body);

				const cart = parseCart(body);

				if (cart === null) {
					this._logProblem("Retrieving the cart", "the cart Picnic sent back could not be read");
					return;
				}

				this._logProblem("Retrieving the cart", null);
				// the cart going from something to nothing is what placing an
				// order looks like from here, so that is asked about right away
				const emptied = this._cart && this._cart["productCount"] > 0 && !(cart["productCount"] > 0);

				this._cart = Object.assign(cart, { "refreshedAt": Date.now() });

				if (emptied) this._refreshOrder();

				return this._publishDeliveryState();
			})
			.catch(async error => {
				if (hasCode(error, SECOND_FACTOR_REQUIRED)) return await this._signInRequired();

				// the widget falls back to saying nothing is planned, which is
				// true as far as the app knows, so this is not worth a crash
				this._logProblem("Retrieving the cart", describeError(error));
			})
			.then(() => { this._cartRefreshing = null; }, () => { this._cartRefreshing = null; });

		return this._cartRefreshing;
	}

	// Asks Picnic about orders outside the poll's own schedule, on behalf of a
	// widget that is being looked at. The poll does the work, so an order
	// found this way fires its flows and is published like any other.
	// Answers with the poll under way, or null when none could be started.
	_refreshOrder() {
		if (this._orderRefreshing) return this._orderRefreshing;
		if (!this.homey.settings.get("x-picnic-auth") || this._picnicOutOfReach()) return null;

		// the poll settles either way, so the flag is always cleared
		this._orderRefreshing = Promise.resolve(this.pollOrder())
			.catch(error => this._logProblem("Asking Picnic about orders", describeError(error)))
			.then(() => { this._orderRefreshing = null; });

		return this._orderRefreshing;
	}

	// The delivery that was just made, as far as the widget is concerned. In
	// memory for the same reason as the cart. The moment Picnic says it arrived
	// replaces the moment the poll noticed, which can be an hour later.
	_refreshDeliveryWhenStale(deliveryId) {
		if (this._deliveryRefreshing === true) return;
		if (this._delivery && this._delivery["deliveryId"] == deliveryId && Date.now() - this._delivery["refreshedAt"] < DELIVERY_MAX_AGE) return;
		if (!this.homey.settings.get("x-picnic-auth") || this._picnicOutOfReach()) return;

		this._deliveryRefreshing = true;

		this.utils.getDelivery(deliveryId)
			.then(body => {
				this._logResponse("GET /api/15/deliveries/" + deliveryId, body);

				const delivery = parseDelivery(body);

				if (delivery === null) {
					this._logProblem("Retrieving the delivery", "the delivery Picnic sent back could not be read");
					return;
				}

				this._logProblem("Retrieving the delivery", null);
				this._delivery = Object.assign(delivery, { "deliveryId": deliveryId, "refreshedAt": Date.now() });

				if (delivery["deliveredAt"] && delivery["deliveredAt"] != this.homey.settings.get("delivery_time")) {
					this.info("Picnic says the delivery arrived at " + delivery["deliveredAt"] + ", the poll noticed at " + this.homey.settings.get("delivery_time"));
					this.homey.settings.set("delivery_time", delivery["deliveredAt"]);
				}

				return this._publishDeliveryState();
			})
			.catch(async error => {
				if (hasCode(error, SECOND_FACTOR_REQUIRED)) return await this._signInRequired();

				// the widget shows the delivery without the details, which is
				// what it did before it knew to ask for them
				this._logProblem("Retrieving the delivery", describeError(error));
			})
			.then(() => { this._deliveryRefreshing = false; }, () => { this._deliveryRefreshing = false; });
	}

	// What was taken from the account for the delivery that was just made, as
	// far as the widget is concerned: in memory like the delivery itself. The
	// wallet lists payments without saying what they were for, so the newest
	// few are asked about until one turns out to be for this delivery, and
	// that one is asked about again after, since a refund can still change it.
	_refreshChargeWhenStale(deliveryId) {
		if (this._chargeRefreshing === true) return;
		if (this._charge && this._charge["deliveryId"] == deliveryId && Date.now() - this._charge["refreshedAt"] < DELIVERY_MAX_AGE) return;
		if (!this.homey.settings.get("x-picnic-auth") || this._picnicOutOfReach()) return;

		this._chargeRefreshing = true;

		const known = this._charge && this._charge["deliveryId"] == deliveryId ? this._charge : null;

		this._findCharge(deliveryId, known && known["transactionId"])
			.then(found => {
				// not settled yet is asked about again later, and not before; a
				// payment that no longer reads as this delivery's keeps what it
				// said, and the wallet is looked through again next time
				this._charge = Object.assign({ "deliveryId": deliveryId, "amount": null }, found || (known ? { "amount": known["amount"] } : {}), {
					"transactionId": found ? found["transactionId"] : null,
					"refreshedAt": Date.now()
				});
				this._logProblem("Retrieving the payment", null);

				if (found && (!known || known["amount"] !== found["amount"])) {
					this.info("Picnic took " + found["amount"] + " for delivery " + deliveryId);
					return this._publishDeliveryState();
				}
			})
			.catch(async error => {
				if (hasCode(error, SECOND_FACTOR_REQUIRED)) return await this._signInRequired();

				// the widget goes on showing what the order came to
				this._logProblem("Retrieving the payment", describeError(error));
			})
			.then(() => { this._chargeRefreshing = false; }, () => { this._chargeRefreshing = false; });
	}

	async _findCharge(deliveryId, transactionId) {
		var candidates = transactionId ? [transactionId] : [];

		if (candidates.length == 0) {
			const body = await this.utils.getWalletTransactions();
			this._logResponse("POST /api/15/wallet/transactions", body);

			candidates = (parseTransactions(body) || []).slice(0, WALLET_LOOKBACK).map(transaction => transaction["id"]);
		}

		for (const id of candidates) {
			const body = await this.utils.getWalletTransaction(id);
			this._logResponse("GET /api/15/wallet/transactions/{id}", body);

			const transaction = parseTransaction(body);
			if (transaction && transaction["deliveryId"] == deliveryId) {
				return { "transactionId": id, "amount": transaction["amount"] };
			}
		}

		return null;
	}

	// The dashboard is not told to ask again, so a state change has to reach an
	// open widget by itself. The widget asks again on a timer as well, so an
	// event nobody was listening for costs a minute rather than a wrong screen.
	async _publishDeliveryState() {
		try {
			await this.homey.api.realtime("delivery_state", await this.getDeliveryWidgetState());
		} catch (exception) {
			// the widget will ask again by itself, so this is not worth failing a poll over
			this.info("The dashboard widget could not be told about the new state: " + describeError(exception));
		}
	}

	async pollOrder() {
		return new Promise((resolve, reject) => {
			if (this.homey.settings.getKeys().indexOf("x-picnic-auth") > -1 && this.homey.settings.getKeys().indexOf("username") > -1 && this.homey.settings.getKeys().indexOf("password") > -1) {
				this.debug("Polling for new order info")
				this.getOrderStatus().then(async orderEvent => {
					this.debug("Processing order info")
					if (orderEvent == null) {
						this.debug("Nothing to do, the order status did not change")
						return
					}
					if (this._isUnauthorized(orderEvent)) {
						throw toError(orderEvent, "Picnic rejected the auth token while polling");
					}
					else if (orderEvent instanceof Error) {
						this.debug("Order retrieving failed, connectivity issues?")
						throw toError(orderEvent, "The order status could not be retrieved");
					}
					else {
						this.debug("Order_status has changed! Changing tokens, settings and firing the trigger accordingly.")
						if (orderEvent["event"] == 'groceries_ordered') {
							this.debug("Order changed to groceries_ordered, firing trigger")
							const eta_start = this.formatEtaTime(orderEvent["eta1_start"])
							const eta_end = this.formatEtaTime(orderEvent["eta1_end"])
							const eta_date = this.formatEtaDate(orderEvent["eta1_start"])
							const price = orderEvent["price"]

							const data = { 'price': price, 'eta_start': eta_start, 'eta_end': eta_end, 'eta_date': eta_date }

							this.info("Firing the groceries ordered trigger, delivery on " + eta_date + " between " + eta_start + " and " + eta_end + ", price " + price)
							this._groceriesOrderedTrigger.trigger(data)

							this.orderPrice.setValue(price)
							this.orderStatus.setValue("groceries_ordered")
							this.orderDeliveryDate.setValue(eta_date)
							this.orderDeliveryStartWindow.setValue(eta_start)
							this.orderDeliveryEndWindow.setValue(eta_end)

							this.homey.settings.set("order_status", "groceries_ordered")
							this.homey.settings.set("order_price", price)
							this.homey.settings.set("delivery_eta_start", orderEvent["eta1_start"])
							this.homey.settings.set("delivery_eta_end", orderEvent["eta1_end"])
							this.homey.settings.set("delivery_date", eta_date)

							// a new order has nothing announced, no van on the road and
							// nothing delivered yet, and what the previous one left
							// behind is about that one
							this.homey.settings.unset("delivery_announced_at")
							this.homey.settings.unset("delivery_underway_at")
							this.homey.settings.unset("delivery_time")
							this._position = null

							this.debug("Updating poll interval to " + ORDERED_POLL_INTERVAL / 1000 / 60 + " minutes");
							this.homey.app.changeInterval(ORDERED_POLL_INTERVAL);
						}
						else if (orderEvent["event"] == 'delivery_announced') {
							this.debug("Order changed to delivery_announced, firing trigger")
							const tokens = this._etaTokens(orderEvent["eta2_start"], orderEvent["eta2_end"])

							this.info("Firing the delivery announced trigger, window on " + tokens["eta_date"] + " between " + tokens["eta_start"] + " and " + tokens["eta_end"])
							this._deliveryAnnouncedTrigger.trigger(tokens)

							this.orderStatus.setValue("delivery_announced")
							this.orderDeliveryDate.setValue(tokens["eta_date"])
							this.orderDeliveryStartWindow.setValue(tokens["eta_start"])
							this.orderDeliveryEndWindow.setValue(tokens["eta_end"])

							this.homey.settings.set("order_status", "delivery_announced")
							this.homey.settings.set("delivery_eta_start", orderEvent["eta2_start"])
							this.homey.settings.set("delivery_eta_end", orderEvent["eta2_end"])
							this.homey.settings.set("delivery_date", tokens["eta_date"])

							// when Picnic said so, for the record; the widget's bar fills
							// from the moment the van leaves, which is later
							this.homey.settings.set("delivery_announced_at", new Date().toISOString())

							// takes care of the poll interval for this window as well
							await this.createDeliverySchedule(orderEvent["eta2_start"], orderEvent["eta2_end"]);
						}
						else if (orderEvent["event"] == 'delivery_eta_updated') {
							const tokens = this._etaTokens(orderEvent["eta2_start"], orderEvent["eta2_end"])

							this.info("Picnic moved the delivery window to " + tokens["eta_date"] + " between " + tokens["eta_start"] + " and " + tokens["eta_end"] + ", rescheduling")

							this.orderDeliveryDate.setValue(tokens["eta_date"])
							this.orderDeliveryStartWindow.setValue(tokens["eta_start"])
							this.orderDeliveryEndWindow.setValue(tokens["eta_end"])

							this.homey.settings.set("delivery_eta_start", orderEvent["eta2_start"])
							this.homey.settings.set("delivery_eta_end", orderEvent["eta2_end"])
							this.homey.settings.set("delivery_date", tokens["eta_date"])

							// deliberately not moving delivery_announced_at along with the
							// window: the announcement happened when it happened, and
							// restarting the bar on every refinement would have it crawl
							// towards a delivery that keeps stepping away from it

							// deliberately no delivery_announced trigger: the
							// announcement already happened and firing it again
							// would notify everyone twice
							await this.createDeliverySchedule(orderEvent["eta2_start"], orderEvent["eta2_end"]);
						}
						else if (orderEvent["event"] == 'groceries_delivered') {
							this.debug("Order changed to groceries_delivered, firing trigger")

							this.pruneDeliverySchedule(orderEvent["delivery_time"])

							// the van has been and gone
							this.homey.settings.unset("delivery_underway_at")
							this._position = null

							// the delivery this trigger is about, so a flow does not
							// have to read the global tokens to know what arrived
							const data = Object.assign(
								this._etaTokens(this.homey.settings.get("delivery_eta_start"), this.homey.settings.get("delivery_eta_end")),
								{ 'delivery_time': this.formatEtaTime(orderEvent["delivery_time"]) }
							)

							this.info("Firing the groceries delivered trigger, delivered at " + data["delivery_time"])
							await this._groceriesDelivered.trigger(data)

							await this.orderStatus.setValue("groceries_delivered")

							this.homey.app.changeInterval(DEFAULT_POLL_INTERVAL);

							this.homey.settings.set("order_status", "groceries_delivered")

							// the moment itself rather than the formatted token, so the
							// widget can tell a delivery from an hour ago apart from one
							// from this morning
							this.homey.settings.set("delivery_time", orderEvent["delivery_time"])
						}

						// the dashboard has no reason to ask, so a change has to find its
						// way to an open widget by itself
						await this._publishDeliveryState()
					}
				})
					.then(() => this._logProblem("Polling Picnic", null), error => this._pollFailed(error))
					.then(() => resolve(), error => {
						// nothing else is left to report a
						// failure in the failure handler
						this._logCrash("Handling a polling failure went wrong itself", error);
						resolve();
					});
			} else if (this._waitingOnTheUser() !== null) {
				// Logging in again cannot get past a second factor: only the
				// person holding the phone can. It used to be tried every hour,
				// and every hour Picnic sent them another text message.
				this._reportWaitingOnTheUser()
				resolve()
			} else if (this.homey.settings.getKeys().indexOf("username") > -1 && this.homey.settings.getKeys().indexOf("password") > -1) {
				this.info("No auth token stored, logging in with the stored credentials")
				this.login(this.homey.settings.get("username"), this.homey.settings.get("password"))
					.then(result => {
						this.info("Logging in with the stored credentials: " + result)
						this._logProblem("Logging in with the stored credentials", result == "success" ? null : result)
						resolve()
					}, error => {
						this._logProblem("Logging in with the stored credentials", describeError(error))
						resolve()
					});
			} else {
				this.info("Not polling: no username and password stored, so nothing can be retrieved")
				resolve()
			}
		});
	}

	// Everything that goes wrong while polling ends up here. It used to become
	// "an unexpected error occured" on a promise nobody awaited, and crash.
	async _pollFailed(error) {
		// Checked before a rejected token: logging in again would only hand out
		// another token Picnic refuses for the same reason, and a login that
		// succeeds polls straight away, so the two would chase each other.
		if (hasCode(error, SECOND_FACTOR_REQUIRED)) {
			this._logProblem("Polling Picnic", describeError(error));
			await this._signInRequired();
			return;
		}

		if (this._isUnauthorized(error)) {
			const waiting = this._waitingOnTheUser();

			if (waiting !== null) {
				this.info("Picnic rejected the auth token while polling, but " + waiting)
				return;
			}

			this.info("Picnic rejected the auth token while polling, logging in again")

			const result = await this.login(this.homey.settings.get('username'), this.homey.settings.get('password'));

			if (result == "success") {
				this._logProblem("Renewing the auth token", null);
				this.info("Auth token succesfully renewed")
			} else {
				this._logProblem("Renewing the auth token", result);
				this.logState("State after Picnic refused the stored credentials");
			}
			return;
		}

		const description = describeError(error);

		// polling can run every minute: report in full when the failure starts
		if (this._logProblem("Polling Picnic", description)) {
			this.info("Polling Picnic failed, it came from: " + describeStack(error));
			this.logState("State when polling failed");
		}
	}

	// The one failure the poll answers by logging in again. It arrives as a
	// string, or as an Error with a code, either possibly wrapped.
	_isUnauthorized(error) {
		for (let value = error, depth = 0; value !== undefined && value !== null && depth < 10; depth++) {
			if (String(value) == "Error: unauthorized") return true;
			if (typeof value !== 'object') return false;
			if (value.code === utils.UNAUTHORIZED) return true;
			if (value.statusCode === 401) return true;
			value = value.cause;
		}

		return false;
	}

	changeInterval(interval) {
		this.info("Polling Picnic every " + interval / 1000 / 60 + " minute(s)");
		clearInterval(runningInterval);
		runningInterval = setInterval(this.pollOrder.bind(this), interval);
	}

	// node-schedule returns null for a moment that already passed, which happens
	// on an app update or reboot halfway through the delivery window. Say so
	// instead of pretending the job was planned.
	_scheduleJob(runAt, description, callback, jobs) {
		// an invalid date is not refused but read as a recurring spec, which
		// would fire the job every minute rather than never
		if (isNaN(runAt.getTime())) {
			this.info("Not scheduling " + description + ", the moment to run it at is unknown");
			return null;
		}

		const job = schedule.scheduleJob(runAt, callback);

		if (job === null) {
			this.info("Not scheduling " + description + ", " + runAt.toString() + " has already passed");
			return null;
		}

		this.info("Scheduled " + description + " at " + runAt.toString());
		jobs.push(job);
		return job;
	}

	_cancelJobs(jobs, description) {
		if (jobs.length == 0) return;

		this.debug("Cancelling " + jobs.length + " scheduled " + description + " job(s)");
		jobs.forEach(job => job.cancel());
		jobs.length = 0;
	}

	cancelDeliverySchedule() {
		this._cancelJobs(this._deliveryWindowJobs, "delivery window");
		this._cancelJobs(this._deliverySoonJobs, "delivered soon");
		this._cancelJobs(this._pollRateJobs, "poll rate");
	}

	// What is left of the schedule once the groceries are on the counter. The
	// warning and the faster polling are about a delivery that is still coming,
	// so they go. The window triggers stay: they have marked the window Picnic
	// announced since they were added, not the moment the van showed up, and
	// flows are built on that. Picnic delivering early does not unannounce the
	// window. The one exception is a delivery that beats the window to it, since
	// that window never became real.
	pruneDeliverySchedule(deliveredAt) {
		this._cancelJobs(this._deliverySoonJobs, "delivered soon");
		this._cancelJobs(this._pollRateJobs, "poll rate");

		if (windowTriggersStillApply(this.homey.settings.get("delivery_eta_start"), deliveredAt)) {
			this.info("Keeping the announced window triggers planned, they are about the window rather than about the delivery");
			return;
		}

		this.info("Delivered before the announced window started, so its start and end triggers have nothing left to mark");
		this._cancelJobs(this._deliveryWindowJobs, "delivery window");
	}

	// one job per unique head start, the run listener sorts out which flow gets it
	async _createDeliverySoonSchedule(deliveryStart, eta_start, eta_end) {
		this._cancelJobs(this._deliverySoonJobs, "delivered soon");

		var argumentValues = [];

		try {
			argumentValues = await this._deliverySoonTrigger.getArgumentValues();
		} catch (exception) {
			this.homey.error(exception);
			return;
		}

		const minutesUpfront = [...new Set(argumentValues.map(args => args["minutes"]))];

		minutesUpfront.forEach(minutes => {
			const runAt = new Date(deliveryStart.getTime() - 1000 * 60 * minutes);

			// an announcement can arrive later than the configured head start,
			// in which case there is nothing left to warn about
			this._scheduleJob(runAt, "the delivered soon trigger, " + minutes + " minutes upfront", () => {
				this.info("Firing the delivered soon trigger, " + minutes + " minutes before the window starts")
				this._deliverySoonTrigger.trigger(this._etaTokens(eta_start, eta_end), { 'minutes': minutes })
			}, this._deliverySoonJobs);
		});
	}

	// argument values only mean something at planning time, so a flow built or
	// changed after the announcement needs its job planned after the fact
	async rescheduleDeliverySoon() {
		if (this.homey.settings.get("order_status") != "delivery_announced") {
			this.debug("A delivered soon flow changed, but there is no announced delivery to plan for");
			return;
		}

		const eta_start = this.homey.settings.get("delivery_eta_start");
		const eta_end = this.homey.settings.get("delivery_eta_end");
		const deliveryStart = new Date(eta_start);

		if (!eta_start || isNaN(deliveryStart.getTime())) {
			this.info("A delivered soon flow changed, but the delivery window is unknown");
			return;
		}

		this.debug("A delivered soon flow changed, replanning against the known delivery window");
		await this._createDeliverySoonSchedule(deliveryStart, eta_start, eta_end);
	}

	async createDeliverySchedule(eta_start, eta_end) {
		// planning is always for the one window we know about, so start over
		this.cancelDeliverySchedule();

		const deliveryStart = new Date(eta_start);
		const deliveryEnd = new Date(eta_end);

		if (!eta_start || !eta_end || isNaN(deliveryStart.getTime()) || isNaN(deliveryEnd.getTime())) {
			this.info("Not scheduling anything, the delivery window is unknown (start: " + eta_start + ", end: " + eta_end + ")");
			this.changeInterval(ORDERED_POLL_INTERVAL);
			return;
		}

		const now = new Date();
		const deliveryStartMin30 = new Date(deliveryStart.getTime() - 1000 * 60 * 30);

		// scheduling increase of the polling rate 30min before the delivery time
		if (this._scheduleJob(deliveryStartMin30, "the poll rate increase", () => {
			this.changeInterval(DELIVERY_POLL_INTERVAL);
		}, this._pollRateJobs)) {
			this.debug("Until that time, using ORDERED interval");
			this.changeInterval(ORDERED_POLL_INTERVAL);
		} else if (deliveryEnd > now) {
			this.debug("Already within 30 minutes of the delivery window, increasing the poll rate right away");
			this.changeInterval(DELIVERY_POLL_INTERVAL);
		} else {
			this.debug("The delivery window has passed, using ORDERED interval until Picnic confirms the delivery");
			this.changeInterval(ORDERED_POLL_INTERVAL);
		}

		// schedule beginning of delivery window trigger
		this._scheduleJob(deliveryStart, "the start of the delivery window trigger", () => {
			this.info("Firing the start of the delivery window trigger")
			this._deliveryAnnouncedTriggerBeginTime.trigger(this._etaTokens(eta_start, eta_end))
		}, this._deliveryWindowJobs);

		// schedule ending of delivery window trigger
		this._scheduleJob(deliveryEnd, "the end of the delivery window trigger", () => {
			this.info("Firing the end of the delivery window trigger")
			this._deliveryAnnouncedTriggerEndTime.trigger(this._etaTokens(eta_start, eta_end))
		}, this._deliveryWindowJobs);

		await this._createDeliverySoonSchedule(deliveryStart, eta_start, eta_end);
	}

	async setCountry(country) {
		this.debug("Setting country to: " + country);
		await this.homey.settings.set("country", country.toLowerCase());
		this.setUrl()
	}

	async setUrl() {
		switch (this.homey.settings.get("country")) {
			case "nl":
				this.log("Using the NL endpoint")
				this.homey.settings.set("url", "storefront-prod.nl.picnicinternational.com")
				break;
			case "de":
				this.log("Using the DE endpoint")
				this.homey.settings.set("url", "storefront-prod.de.picnicinternational.com")
				break;
		}
	}

	// Why the app cannot get itself a session, when the reason is the user
	// rather than anything it could do about it. Both reasons end at the
	// settings page: one has a code waiting to be typed in, the other needs the
	// sign-in that has Picnic send a code in the first place.
	_waitingOnTheUser() {
		if (twofactor.awaitingVerification(this._twoFactorState())) {
			return "a 2FA code is still waiting to be verified on the settings page";
		}

		if (this.homey.settings.get("2fa_signin_required") === true) {
			return "Picnic wants a 2FA code, which only a sign-in on the settings page asks for";
		}

		return null;
	}

	// The poll runs as often as every minute and this state lasts until someone
	// acts on it, so say it when it starts rather than on every attempt.
	_reportWaitingOnTheUser() {
		const reason = this._waitingOnTheUser();

		if (reason === null || reason === this._waitingLogged) return;

		this._waitingLogged = reason;
		this.info("Not polling: " + reason)
	}

	// The 2FA state the decisions in lib/twofactor.js are made on.
	_twoFactorState() {
		return {
			pendingToken: this.homey.settings.get("x-picnic-auth-pending"),
			pendingFlag: this.homey.settings.get("2fa_pending") === true,
			codeRequestedAt: this.homey.settings.get("2fa_code_requested_at")
		};
	}

	// Nothing about the second factor is outstanding any more, so the app is
	// free to log in on its own again.
	_clearPendingVerification() {
		this.homey.settings.unset("x-picnic-auth-pending");
		this.homey.settings.unset("2fa_code_requested_at");
		this.homey.settings.unset("2fa_signin_required");
		this.homey.settings.set("2fa_pending", false);
		this._waitingLogged = null;
	}

	// Picnic will only hand out a session once a code it sent over SMS is
	// verified, and the app does not ask for that code: doing so on its own
	// initiative is a text message the user never asked for, and the hourly
	// poll made it an hourly text message. So the login stops here and waits
	// for a sign-in on the settings page, which is the one place someone is
	// holding the phone the code goes to.
	async _signInRequired() {
		const alreadyKnown = this.homey.settings.get("2fa_signin_required") === true;

		this.homey.settings.unset("x-picnic-auth");
		this._clearPendingVerification();
		this.homey.settings.set("2fa_signin_required", true);

		this.info("Picnic wants a 2FA code, which the app does not request by itself: waiting for a sign-in on the settings page")

		// an open dashboard would otherwise go on showing the last order it
		// was told about as if it were still being followed
		await this._publishDeliveryState();

		// The poll stops at this state, so it will not come back through here:
		// this is the one chance to say so, and saying it twice would take a
		// second login that only the user can start anyway.
		if (alreadyKnown) return;

		await this._notify("notifications.2fa-signin", "the sign-in Picnic wants");
	}

	// Waiting on the user is only useful if the user is told. Nothing else
	// does: the app log and the settings page are both places someone has to
	// think to look.
	async _notify(key, subject) {
		try {
			await this.homey.notifications.createNotification({
				excerpt: this.homey.__(key)
			});
		} catch (exception) {
			this.info("The notification about " + subject + " could not be created: " + describeError(exception))
		}
	}

	/**
	 * Logs in with the given credentials.
	 *
	 * @param {string} username
	 * @param {string} password
	 * @param {Object} [options] { requestedByUser } for a login someone is
	 *        waiting on, which is always worth an SMS: they are holding the phone
	 * @returns {Promise<string>} "success", "2fa_required", or what went wrong
	 */
	async login(username, password, options) {
		const requestedByUser = !!(options && options.requestedByUser);

		var post_data = {
			key: username,
			secret: md5(password),
			client_id: 30100
		};

		this.debug("Logging in with: " + username + " in: " + this.homey.settings.get("country"))
		this.debug("To URL: " + this.homey.settings.get("url"))
		this.info("Logging in to the " + (this.homey.settings.get("country") || "unknown") + " store")
		var json_data = JSON.stringify(post_data)

		var options = {
			hostname: this.homey.settings.get("url"),
			port: 443,
			path: '/api/15/user/login',
			method: 'POST',
			timeout: 5000,
			headers: {
				"User-Agent": "okhttp/3.9.0",
				"Content-Type": "application/json; charset=UTF-8",
				"client_id": "30100",
				"device_id": PICNIC_DID,
				"x-picnic-did": PICNIC_DID,
				"x-picnic-agent": PICNIC_AGENT
			}
		}

		return new Promise((resolve) => {
			const req = http.request(options, (res) => {
				let body = '';
				res.setEncoding('utf8');
				res.on('data', (chunk) => { body += chunk; });
				res.on('end', () => {
					if (res.statusCode == 200) {
						this.debug("Authentication succeeded.")
						this.debug("JWT:" + res.headers['x-picnic-auth'])

						let responseData = {};
						try { responseData = JSON.parse(body); } catch (e) { /* empty or non-json body is fine */ }

						this.homey.settings.set("username", username)
						this.homey.settings.set("password", password)

						if (responseData.second_factor_authentication_required === true) {
							// an SMS is only ever worth sending to someone who
							// is waiting for it, so a login the app made on its
							// own stops short of asking for a code
							if (requestedByUser === false) {
								this._signInRequired().then(() => resolve("2fa_signin_required"));
								return
							}

							this.info("Login needs a 2FA code, requesting one over SMS")

							// A code is verified against the token the login it
							// came from handed out, so the two are stored
							// together: keeping a token from an earlier login
							// would make the code that arrives now fail.
							this._clearPendingVerification()
							this.homey.settings.set("2fa_pending", true)
							this.homey.settings.unset("x-picnic-auth")
							this.homey.settings.set("x-picnic-auth-pending", res.headers['x-picnic-auth'])

							this.generate2FACode("SMS")
								.then(() => resolve("2fa_required"), () => resolve("2fa_required"));
						} else {
							this._clearPendingVerification()
							this.homey.settings.set("x-picnic-auth", res.headers['x-picnic-auth'])
							this.info("Login accepted by Picnic, auth token stored")
							this.pollOrder();
							resolve("success");
						}
					}
					else {
						this.info("Login refused by Picnic (HTTP " + res.statusCode + ")")
						this.homey.app.changeInterval(DEFAULT_POLL_INTERVAL);
						resolve('Problem with request or authentication failed.');
					}
				});
			});

			req.on('error', (e) => {
				this.info("Login request to " + options.hostname + " failed: " + e.message)
				resolve('Problem with request or authentication failed.');
			});

			req.write(json_data);
			req.end();
		});
	}

	// The only thing in the app that has Picnic send a text message, and the
	// login someone started on the settings page is the only thing that calls it.
	async generate2FACode(channel) {
		var json_data = JSON.stringify({ channel: channel || "SMS" });
		var options = {
			hostname: this.homey.settings.get("url"),
			port: 443,
			path: '/api/15/user/2fa/generate',
			method: 'POST',
			timeout: 5000,
			headers: {
				"User-Agent": "okhttp/3.9.0",
				"Content-Type": "application/json; charset=UTF-8",
				"x-picnic-auth": this.homey.settings.get("x-picnic-auth-pending") || this.homey.settings.get("x-picnic-auth"),
				"x-picnic-did": PICNIC_DID,
				"x-picnic-agent": PICNIC_AGENT
			}
		}

		this.debug("Requesting 2FA code via " + (channel || "SMS"))

		return new Promise((resolve, reject) => {
			const req = http.request(options, (res) => {
				let body = '';
				res.setEncoding('utf8');
				res.on('data', (chunk) => { body += chunk; });
				res.on('end', () => {
					if (res.statusCode >= 200 && res.statusCode < 300) {
						// what tells a later login that a usable code is out there
						this.homey.settings.set("2fa_code_requested_at", Date.now())
						this.info("Picnic sent a 2FA code")
						resolve("success");
					} else {
						this.info("Picnic refused to send a 2FA code (HTTP " + res.statusCode + ")")
						reject(new Error("2FA code request failed: " + res.statusCode));
					}
				});
			});

			req.on('error', (e) => {
				this.info("The request for a 2FA code failed: " + e.message)
				reject(e);
			});

			req.write(json_data);
			req.end();
		});
	}

	async verify2FACode(otp) {
		var json_data = JSON.stringify({ otp: String(otp || "") });
		var options = {
			hostname: this.homey.settings.get("url"),
			port: 443,
			path: '/api/15/user/2fa/verify',
			method: 'POST',
			timeout: 5000,
			headers: {
				"User-Agent": "okhttp/3.9.0",
				"Content-Type": "application/json; charset=UTF-8",
				"x-picnic-auth": this.homey.settings.get("x-picnic-auth-pending") || this.homey.settings.get("x-picnic-auth"),
				"x-picnic-did": PICNIC_DID,
				"x-picnic-agent": PICNIC_AGENT
			}
		}

		this.debug("Verifying 2FA code")

		return new Promise((resolve) => {
			const req = http.request(options, (res) => {
				let body = '';
				res.setEncoding('utf8');
				res.on('data', (chunk) => { body += chunk; });
				res.on('end', () => {
					if (res.statusCode >= 200 && res.statusCode < 300) {
						const newAuth = res.headers['x-picnic-auth'];
						if (newAuth) {
							this.info("2FA code accepted, Picnic handed out a new auth token")
							this.homey.settings.set("x-picnic-auth", newAuth);
						} else if (this.homey.settings.get("x-picnic-auth-pending")) {
							// the login moved the token to the pending key and
							// unset x-picnic-auth, so there is no existing token
							// to keep: the pending one is the verified one now
							this.info("2FA code accepted, keeping the auth token from the login")
							this.homey.settings.set("x-picnic-auth", this.homey.settings.get("x-picnic-auth-pending"));
						} else {
							this.info("2FA code accepted, but there is no auth token to store, so logging in again is needed")
						}

						// nothing is waiting to be verified any more, in all
						// three cases: leaving it pending would stop the poll
						// from ever logging in again
						this._clearPendingVerification();

						this.pollOrder();
						resolve("success");
					} else {
						// a code the settings page puts in words, rather than the
						// words themselves: only that page knows the language
						this.info("Picnic rejected the 2FA code (HTTP " + res.statusCode + ")")
						resolve("invalid_code");
					}
				});
			});

			req.on('error', (e) => {
				this.info("The 2FA verification request failed: " + e.message)
				resolve("Problem with request or 2FA verification failed.");
			});

			req.write(json_data);
			req.end();
		});
	}

	// The way out of a login that cannot be finished: a code that never arrived,
	// one that expired while the phone was in another room. Nothing is sent
	// here, and no notification either, since whoever pressed this is looking
	// at the page that tells them what to do next.
	async cancelPendingVerification() {
		this._clearPendingVerification();
		this.homey.settings.set("2fa_signin_required", true);

		this.info("The waiting 2FA code was given up on from the settings page, so a sign-in is needed to have a new one sent")

		return "OK";
	}

	async getOrderStatusFromSettings() {
		return this.homey.settings.get("order_status");
	}

	async resetOrderStatus() {
		this.homey.settings.set("order_status", "");
	}

	// Whether Picnic still accepts the token we have. Only Picnic refusing the
	// credentials is "NOT OK": a call that never got an answer says nothing
	// about them, and saying NOT OK anyway sends people looking for a login
	// problem they do not have. The outcome is logged unconditionally, the
	// check runs when someone opens the settings page and the status code is
	// the one thing needed to tell these cases apart afterwards.
	async getStatus() {
		this.logState("State when the settings page was opened")

		const twoFactor = this._twoFactorState();

		if (twofactor.verificationPending(twoFactor)) {
			if (twofactor.codeIsUsable(twoFactor, Date.now())) {
				this.info("Authentication check: a 2FA code is still waiting to be verified")
				return "2FA PENDING";
			}

			// Saying a code is waiting sends someone looking for a text message
			// that Picnic will refuse by the time they find it.
			this.info("Authentication check: the 2FA code this login was waiting for is too old to still work, so a sign-in is needed to have a new one sent")
			return "SIGN IN NEEDED";
		}

		// Picnic accepted the credentials and then asked for a second factor,
		// so this is not a credential problem: it is a code nobody has yet,
		// and saving the login here is what has Picnic send one.
		if (this.homey.settings.get("2fa_signin_required") === true) {
			this.info("Authentication check: Picnic wants a 2FA code, so a sign-in is needed to have one sent")
			return "SIGN IN NEEDED";
		}

		const token = this.homey.settings.get("x-picnic-auth");

		if (!token) {
			this.info("Authentication check: no auth token stored, so there is nothing to check")
			return "NOT OK";
		}

		var options = {
			hostname: this.homey.settings.get("url"),
			port: 443,
			path: '/api/15/cart',
			method: 'GET',
			timeout: 5000,
			headers: {
				"User-Agent": "okhttp/3.9.0",
				"Content-Type": "application/json; charset=UTF-8",
				"x-picnic-auth": token,
				"x-picnic-did": PICNIC_DID,
				"x-picnic-agent": PICNIC_AGENT
			}
		}

		return new Promise((resolve) => {
			const req = http.request(options, (res) => {
				if (res.statusCode >= 200 && res.statusCode < 300) {
					// the body is not used, reading it releases the socket
					res.resume();
					this.info("Authentication check: Picnic accepted the token on " + options.path + " (HTTP " + res.statusCode + ")")
					return resolve("OK");
				}

				// a refusal is read, because it is the body that tells a token
				// Picnic rejects apart from one waiting on its second factor
				let body = '';
				res.setEncoding('utf8');
				res.on('data', (chunk) => { body += chunk; });
				res.on('end', () => {
					if (hasCode(refusal(res.statusCode, body, "the cart"), SECOND_FACTOR_REQUIRED)) {
						// the credentials are fine, a code is what is missing, and
						// saving the login on this page is what has Picnic send one
						this.info("Authentication check: Picnic wants a 2FA code before it accepts the token on " + options.path + " (HTTP " + res.statusCode + ")")
						resolve("SIGN IN NEEDED");
					}
					else if (res.statusCode == 401 || res.statusCode == 403) {
						this.info("Authentication check: Picnic refused the token on " + options.path + " (HTTP " + res.statusCode + ")")
						resolve("NOT OK");
					}
					else {
						this.info("Authentication check: unexpected answer from Picnic on " + options.path + " (HTTP " + res.statusCode + ")")
						resolve("UNKNOWN (HTTP " + res.statusCode + ")");
					}
				});
			});

			req.on('timeout', () => {
				// a socket timeout does not end the request by itself, without
				// this the promise would never settle and the settings page
				// would sit on "loading..." forever
				req.destroy(new Error("no response within " + options.timeout + "ms"));
			});

			req.on('error', (e) => {
				this.info("Authentication check: could not reach " + options.hostname + ": " + e.message)
				resolve("UNKNOWN (" + e.message + ")");
			});

			req.end();
		});
	}
	async getOrderStatus() {
		return new Promise((resolve, reject) => {
			this.utils.getOrderStatus().then(content => {
				if (DEBUG) {
					this.debug("Order info received, raw json:")
					//this.debug(this.homey.settings.get("x-picnic-auth"))
					this.debug(content)
				}
				if (typeof content == 'undefined') return reject(new Error("Picnic answered the order request with nothing at all"));

				this._logResponse("POST /api/15/deliveries/summary [\"CURRENT\"]", content);

				var summary;
				try {
					summary = JSON.parse(content);
					// only now, an answer that cannot be read is not an answer
					this._logProblem("Retrieving the order", null);
					// what the widget measures the stored state against: what
					// Picnic has not confirmed in a long time is not shown as news
					this.homey.settings.set("order_checked_at", new Date().toISOString());
				} catch (exception) {
					// the answer is the only thing that explains why it could not be read
					return reject(toError(exception, "The order info from Picnic could not be read, it answered " + describeBody(content)));
				}

				// read on every poll rather than off an event: an order placed
				// before this app version knew about cut off times would
				// otherwise never get one
				this._storeOrderFacts(deriveOrderFacts(summary));

				const previousStatus = this.homey.settings.get("order_status")
				const orderEvent = deriveOrderEvent(summary, previousStatus, {
					"start": this.homey.settings.get("delivery_eta_start"),
					"end": this.homey.settings.get("delivery_eta_end")
				});

				if (orderEvent == null) {
					this.debug("Order status did not change, current order status: " + previousStatus)
					return resolve(null)
				}

				this.info("Order status changed from " + (previousStatus || "unknown") + " to " + orderEvent["event"])
				return resolve(orderEvent)
			})
				.catch(error => {
					this._logProblem("Retrieving the order", describeError(error))
					reject(error)
				})
		})
	};
}

module.exports = Picnic;
