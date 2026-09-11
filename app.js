'use strict';

const Homey = require('homey');
const actions = require('./lib/actions.js');
const conditions = require('./lib/conditions.js')
const utils = require('./lib/utils.js');
const { deriveOrderEvent, windowTriggersStillApply } = require('./lib/orderevent.js');
const eta = require('./lib/eta.js');

var http = require("https");
var md5 = require("md5");
const schedule = require('node-schedule');

var DEFAULT_POLL_INTERVAL = 1000 * 60 * 60 * 6 // 6 hours
var ORDERED_POLL_INTERVAL = 1000 * 60 * 60 * 1 // 1 hour
var DELIVERY_POLL_INTERVAL = 1000 * 60 * 1 // 1 minute

const DEBUG = false

var runningInterval;

class Picnic extends Homey.App {

	onInit() {
		this.homey.log('Picnic is running...')

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

		if (this.homey.settings.getKeys().indexOf("x-picnic-auth") != -1) {
			this.debug("Auth found, retrieving order")
			this.pollOrder();
		}
	}

	async onUninit() {
		this.debug("Picnic is stopping, cleaning up the timers")
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
					if (orderEvent.toString() == "Error: unauthorized") {
						this.debug("Error: unauthorized, please check your credentials")
						this.login(this.homey.settings.get('username'), this.homey.settings.get('password'), function (callBack) {
							return Promise.reject(new Error('Re-authentication failed.'));
						});
					}
					else if (orderEvent instanceof Error) {
						this.debug("Order retrieving failed, connectivity issues?")
						return Promise.reject(new Error('Status could not be retrieved.'));
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
							this.debug("Picnic moved the delivery window, updating the tokens and rescheduling")

							const tokens = this._etaTokens(orderEvent["eta2_start"], orderEvent["eta2_end"])

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

							await this._groceriesDelivered.trigger(data)

							await this.orderStatus.setValue("groceries_delivered")

							this.homey.app.changeInterval(DEFAULT_POLL_INTERVAL);

							this.homey.settings.set("order_status", "groceries_delivered")
						}
					}
				})
					.catch(error => {
						if (error == "Error: unauthorized") {
							this.debug("ERROR: unauthorized, trying to retrieve new auth token.")
							this.login(this.homey.settings.get('username'), this.homey.settings.get('password'), function (callback) {
								this.debug(callback)
								if (callback == "success") {
									this.debug("Auth token succesfully renewed.")
									return Promise.resolve('Success');
								} else {
									this.debug("ERROR: Re-authentication failed. Please check your credentials.")
									return Promise.reject('ERROR: Re-authentication failed. Please check your credentials.');
								}
							});
						}
						else {
							this.debug("ERROR: " + error)
							return Promise.reject('Error: an unexpected error occured.')
						}
					});
			} else if (this.homey.settings.getKeys().indexOf("username") > -1 && this.homey.settings.getKeys().indexOf("password")) {
				this.debug("No JWT token found, so trying to retrieve one by authenticating")
				this.login(this.homey.settings.getKeys().indexOf("username"), this.homey.settings.getKeys().indexOf("password"))
			} else {
				this.debug("Not polling for new order info due to insufficient authentication details.")
			}
		});
	}

	changeInterval(interval) {
		this.debug("Changing polling interval to: " + interval / 1000 / 60 + " minutes");
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
			this.debug("Not scheduling " + description + ", the moment to run it at is unknown");
			return null;
		}

		const job = schedule.scheduleJob(runAt, callback);

		if (job === null) {
			this.debug("Not scheduling " + description + ", " + runAt.toString() + " has already passed");
			return null;
		}

		this.debug("Scheduled " + description + " at " + runAt.toString());
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
			this.debug("Keeping the announced window triggers planned, they are about the window rather than about the delivery");
			return;
		}

		this.debug("Delivered before the announced window started, so its start and end triggers have nothing left to mark");
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

		if (isNaN(deliveryStart.getTime())) {
			this.debug("A delivered soon flow changed, but the delivery window is unknown");
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

		if (isNaN(deliveryStart.getTime()) || isNaN(deliveryEnd.getTime())) {
			this.debug("Not scheduling anything, the delivery window is unknown (start: " + eta_start + ", end: " + eta_end + ")");
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
			this._deliveryAnnouncedTriggerBeginTime.trigger(this._etaTokens(eta_start, eta_end))
		}, this._deliveryWindowJobs);

		// schedule ending of delivery window trigger
		this._scheduleJob(deliveryEnd, "the end of the delivery window trigger", () => {
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
				"device_id": "open.app.picnic.homey"
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
							this.debug("2FA required, requesting SMS code.")
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
							this.pollOrder();
							resolve("success");
						}
					}
					else {
						this.debug("ERROR: Authentication failed. Status: " + res.statusCode)
						this.homey.app.changeInterval(DEFAULT_POLL_INTERVAL);
						resolve('Problem with request or authentication failed.');
					}
				});
			});

			req.on('error', (e) => {
				this.debug("ERROR: Problem with request or authentication failed.")
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
				"x-picnic-did": "open.app.picnic.homey",
				"x-picnic-agent": "30100;1.15.233-#15158"
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
						this.debug("2FA code requested successfully.")
						resolve("success");
					} else {
						this.debug("ERROR: 2FA code request failed. Status: " + res.statusCode + " body: " + body)
						reject(new Error("2FA code request failed: " + res.statusCode));
					}
				});
			});

			req.on('error', (e) => {
				this.debug("ERROR: Problem with 2FA generate request: " + e.message)
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
				"x-picnic-did": "open.app.picnic.homey",
				"x-picnic-agent": "30100;1.15.233-#15158"
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
							this.debug("2FA verification succeeded, new auth token received.")
							this.homey.settings.set("x-picnic-auth", newAuth);
							this.homey.settings.unset("x-picnic-auth-pending");
							this.homey.settings.set("2fa_pending", false);
						} else if (this.homey.settings.get("x-picnic-auth-pending")) {
							// the login moved the token to the pending key and
							// unset x-picnic-auth, so there is no existing token
							// to keep: the pending one is the verified one now
							this.debug("2FA verification succeeded without a new auth token, promoting the token the login handed us.")
							this.homey.settings.set("x-picnic-auth", this.homey.settings.get("x-picnic-auth-pending"));
							this.homey.settings.unset("x-picnic-auth-pending");
							this.homey.settings.set("2fa_pending", false);
						} else {
							this.debug("2FA verification succeeded but there is no token to store, logging in again is needed.")
						}
						this.pollOrder();
						resolve("success");
					} else {
						this.debug("ERROR: 2FA verification failed. Status: " + res.statusCode + " body: " + body)
						resolve("Invalid 2FA code. Please try again.");
					}
				});
			});

			req.on('error', (e) => {
				this.debug("ERROR: Problem with 2FA verify request: " + e.message)
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
		if (this.homey.settings.get("2fa_pending") === true || this.homey.settings.get("x-picnic-auth-pending")) {
			this.homey.log("Authentication status check: waiting for a 2FA code to be verified")
			return "2FA PENDING";
		}

		const token = this.homey.settings.get("x-picnic-auth");

		if (!token) {
			this.homey.log("Authentication status check: no auth token stored, so not asking Picnic")
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
				"x-picnic-did": "open.app.picnic.homey",
				"x-picnic-agent": "30100;1.15.233-#15158"
			}
		}

		return new Promise((resolve) => {
			const req = http.request(options, (res) => {
				// the body is not used, reading it releases the socket
				res.resume();

				this.homey.log("Authentication status check: GET https://" + options.hostname + options.path + " responded " + res.statusCode)

				if (res.statusCode >= 200 && res.statusCode < 300) {
					resolve("OK");
				}
				else if (res.statusCode == 401 || res.statusCode == 403) {
					resolve("NOT OK");
				}
				else {
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
				this.homey.log("Authentication status check: request to " + options.hostname + " failed: " + e.message)
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
				if (typeof content == 'undefined') return reject("No content received");

				var summary;
				try {
					summary = JSON.parse(content);
				} catch (exception) {
					return reject("Order info could not be parsed");
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

				this.debug("Retrieved new order status from Picnic: " + orderEvent["event"] + ", old order status was: " + previousStatus)
				return resolve(orderEvent)
			})
				.catch(error => {
					this.debug("ERROR: Order retrieval failed")
					reject(error)
				})
		})
	};
}

module.exports = Picnic;
