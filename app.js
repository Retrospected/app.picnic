'use strict';

const Homey = require('homey');
const actions = require('./lib/actions.js');
const conditions = require('./lib/conditions.js')
const utils = require('./lib/utils.js');
const { deriveOrderEvent, windowTriggersStillApply } = require('./lib/orderevent.js');
const { PICNIC_AGENT, PICNIC_DID } = require('./lib/picnicheaders.js');
const { describeError, describeStack, describeBody, toError } = require('./lib/errors.js');
const eta = require('./lib/eta.js');

var http = require("https");
var md5 = require("md5");
const schedule = require('node-schedule');

var DEFAULT_POLL_INTERVAL = 1000 * 60 * 60 * 6 // 6 hours
var ORDERED_POLL_INTERVAL = 1000 * 60 * 60 * 1 // 1 hour
var DELIVERY_POLL_INTERVAL = 1000 * 60 * 1 // 1 minute

const DEBUG = false

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

	// A rejected promise nobody is waiting on takes the app down, and the crash
	// report is then the message of whatever was rejected and nothing else.
	// Write the failure to the log in full before that happens, and hand on a
	// real Error so a bare string does not arrive as a crash without a stack.
	_logUnexpectedFailures() {
		// the handlers outlive the app object, so a restart in the same process
		// would otherwise stack a second set on top of the first
		if (failureHandlers !== null) {
			process.off('unhandledRejection', failureHandlers.rejection);
			process.off('uncaughtException', failureHandlers.exception);
		}

		failureHandlers = {
			rejection: (reason) => {
				const crash = toError(reason, "Unhandled rejection");

				this._logCrash("A failure nobody handled took the app down", reason);

				// rethrowing keeps the crash, and brings it past the uncaught
				// exception handler below, which should not log it a second time
				this._markCrashLogged(crash);
				throw crash;
			},
			exception: (exception) => {
				this._logCrash("The app crashed", exception);
				throw exception;
			}
		};

		process.on('unhandledRejection', failureHandlers.rejection);
		process.on('uncaughtException', failureHandlers.exception);
	}

	// Everything a report needs and a crash message cannot hold: what failed,
	// where it came from and what state the app was in when it did.
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

	// Remembers a failure that was written to the log, and says whether it was
	// new. A value that cannot be remembered is always treated as new: logging
	// the same crash twice is better than logging it not at all.
	_markCrashLogged(error) {
		if (this._crashLogged === undefined) this._crashLogged = new Set();

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
				? ", a 2FA code is still waiting to be verified" : ""));

		this.info(reason + ": order status " + or("order_status", "unknown")
			+ ", delivery window " + or("delivery_eta_start", "unknown") + " until " + or("delivery_eta_end", "unknown"));
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

	// the token set every delivery window trigger hands to its flow
	_etaTokens(eta_start, eta_end) {
		return {
			'eta_start': this.formatEtaTime(eta_start),
			'eta_end': this.formatEtaTime(eta_end),
			'eta_date': this.formatEtaDate(eta_start)
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
						// throwing rather than rejecting: the handler below is
						// the one place that knows what to do with a failure
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

							// deliberately no delivery_announced trigger: the
							// announcement already happened and firing it again
							// would notify everyone twice
							await this.createDeliverySchedule(orderEvent["eta2_start"], orderEvent["eta2_end"]);
						}
						else if (orderEvent["event"] == 'groceries_delivered') {
							this.debug("Order changed to groceries_delivered, firing trigger")

							this.pruneDeliverySchedule(orderEvent["delivery_time"])

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
						}
					}
				})
					.catch(error => this._pollFailed(error))
					.then(() => resolve(), error => {
						// the handler is the last place that can say anything
						// about a failure, so a failure in it is worth a line
						// of its own rather than an app that goes down quietly
						this._logCrash("Handling a polling failure went wrong itself", error);
						resolve();
					});
			} else if (this.homey.settings.getKeys().indexOf("username") > -1 && this.homey.settings.getKeys().indexOf("password") > -1) {
				this.info("No auth token stored, logging in with the stored credentials")
				this.login(this.homey.settings.get("username"), this.homey.settings.get("password"))
					.then(result => {
						this.info("Logging in with the stored credentials: " + result)
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

	// Everything that goes wrong while polling ends up here. Before this, any
	// failure other than a refused token became "an unexpected error occured"
	// on a promise nobody was waiting on, which took the app down and left a
	// crash report saying exactly that and nothing else.
	async _pollFailed(error) {
		if (this._isUnauthorized(error)) {
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

		// polling runs as often as every minute, so the full report is written
		// when the failure starts rather than on every attempt
		if (this._logProblem("Polling Picnic", description)) {
			this.info("Polling Picnic failed, it came from: " + describeStack(error));
			this.logState("State when polling failed");
		}
	}

	// Picnic refusing the token is the one failure the poll answers by logging
	// in again. It arrives as a string from older code paths and as an Error
	// with a code from the request itself, and may be wrapped in the failure
	// that carries it.
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

	async login(username, password) {
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
							this.info("Login needs a 2FA code, requesting one over SMS")
							this.homey.settings.set("x-picnic-auth-pending", res.headers['x-picnic-auth'])
							this.homey.settings.set("2fa_pending", true)
							this.homey.settings.unset("x-picnic-auth")
							this.generate2FACode("SMS")
								.then(() => resolve("2fa_required"))
								.catch(() => resolve("2fa_required"));
						} else {
							this.homey.settings.unset("x-picnic-auth-pending")
							this.homey.settings.set("2fa_pending", false)
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
							this.homey.settings.unset("x-picnic-auth-pending");
							this.homey.settings.set("2fa_pending", false);
						} else if (this.homey.settings.get("x-picnic-auth-pending")) {
							// the login moved the token to the pending key and
							// unset x-picnic-auth, so there is no existing token
							// to keep: the pending one is the verified one now
							this.info("2FA code accepted, keeping the auth token from the login")
							this.homey.settings.set("x-picnic-auth", this.homey.settings.get("x-picnic-auth-pending"));
							this.homey.settings.unset("x-picnic-auth-pending");
							this.homey.settings.set("2fa_pending", false);
						} else {
							this.info("2FA code accepted, but there is no auth token to store, so logging in again is needed")
						}
						this.pollOrder();
						resolve("success");
					} else {
						this.info("Picnic rejected the 2FA code (HTTP " + res.statusCode + ")")
						resolve("Invalid 2FA code. Please try again.");
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

		if (this.homey.settings.get("2fa_pending") === true || this.homey.settings.get("x-picnic-auth-pending")) {
			this.info("Authentication check: a 2FA code is still waiting to be verified")
			return "2FA PENDING";
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
				// the body is not used, reading it releases the socket
				res.resume();

				if (res.statusCode >= 200 && res.statusCode < 300) {
					this.info("Authentication check: Picnic accepted the token on " + options.path + " (HTTP " + res.statusCode + ")")
					resolve("OK");
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

				var summary;
				try {
					summary = JSON.parse(content);
					// only now, an answer that cannot be read is not an answer
					this._logProblem("Retrieving the order", null);
				} catch (exception) {
					// the answer itself is the only thing that explains why it
					// could not be read, so a report has to carry some of it
					return reject(toError(exception, "The order info from Picnic could not be read, it answered " + describeBody(content)));
				}

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
