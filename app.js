'use strict';

const Homey = require('homey');
const actions = require('./lib/actions.js')
const utils = require('./lib/utils.js')

var http = require("https")
var md5 = require("md5")
const schedule = require('node-schedule');

var DEFAULT_POLL_INTERVAL = 1000 * 60 * 60 * 12 // 12 hours
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

			this.debug("ORDER STATUS: "+this.homey.settings.get("order_status"))
			this.debug("PICNIC USER: "+this.homey.settings.get("username"))
			//this.debug("PICNIC PASS: "+this.homey.settings.get("password"))
			//this.debug("PICNIC JWT: "+this.homey.settings.get("x-picnic-auth"))
		}

		this.actions = new actions({homey: this.homey});
		this.actions.onInit();

		this.utils = new utils({homey: this.homey});

		this.homey.settings.set("additemLock", false)
		
		// simulate fresh install
		//this.homey.settings.unset("order_status")
		//this.homey.settings.unset("delivery_eta_start")
		//this.homey.settings.unset("x-picnic-auth")
		//this.homey.settings.unset("username")
		//this.homey.settings.unset("password")
		//this.homey.settings.set("order_status", "delivery_announced")

		// retrieve initial order info
		if (this.homey.settings.getKeys().indexOf("x-picnic-auth") != -1)
		{
			this.debug("Auth found, retrieving order")
			this.pollOrder();
		}

		this._initAppTokens();
		this._initFlowTriggers();
		this._initTimers();
	}

	async _initAppTokens() {
		
		// Create app tokens (labels)
		let orderStatus = await this.homey.flow.createToken( 'order_status', {
			type: 'string',
			title: this.homey.__('tokens.order.status')
		});

		let orderPrice = await this.homey.flow.createToken( 'order_price', {
			type: 'number',
			title: this.homey.__('tokens.order.price')
		});

		let orderDeliveryDate = await this.homey.flow.createToken( 'order_deliverydate', {
			type: 'string',
			title: this.homey.__('tokens.delivery.date')
		});

		let orderDeliveryStartWindow = await this.homey.flow.createToken( 'order_deliverystartwindow', {
			type: 'string',
			title: this.homey.__('tokens.delivery.startwindow')
		});

		let orderDeliveryEndWindow = await this.homey.flow.createToken( 'order_deliveryendwindow', {
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
			await this.orderDeliveryStartWindow.setValue(this.homey.settings.get("delivery_eta_start"));
		} else {
			await this.orderDeliveryStartWindow.setValue("")
		}

		if (this.homey.settings.get("delivery_eta_end") !== null) {
			await this.orderDeliveryEndWindow.setValue(this.homey.settings.get("delivery_eta_end"));
		} else {
			await this.orderDeliveryEndWindow.setValue("")
		}
	}

	async _initFlowTriggers() {
		this._groceriesOrderedTrigger = this.homey.flow
		.getTriggerCard('groceries_ordered')
		.registerRunListener();
		this._deliveryAnnouncedTrigger = this.homey.flow
		.getTriggerCard('delivery_announced')
		.registerRunListener();

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

			if (this.homey.settings.getKeys().indexOf("delivery_eta_start") != -1) {
				this.debug("30 minutes before delivery we will increase polling interval");
				this.homey.app.createDeliverySchedule(this.homey.settings.get("delivery_eta_start"), this.homey.settings.get("delivery_eta_end"));
			}

			this.debug("Until delivery time, using ORDERED interval");
			this.homey.app.changeInterval(ORDERED_POLL_INTERVAL);
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

	async pollOrder() {
		return new Promise((resolve, reject) => {
			if (this.homey.settings.getKeys().indexOf("x-picnic-auth") > -1 && this.homey.settings.getKeys().indexOf("username") > -1 && this.homey.settings.getKeys().indexOf("password") > -1) {
				this.debug("Polling for new order info")
				this.getOrderStatus().then(orderEvent => {
					this.debug("Processing order info")
					if ( orderEvent.toString() == "Error: unauthorized" ) {
						this.debug("Error: unauthorized, please check your credentials")
						this.login(this.homey.settings.get('username'), this.homey.settings.get('password'), function(callBack) {
							return Promise.reject(new Error('Re-authentication failed.'));
						});
					}
					else if ( orderEvent instanceof Error ) {
						this.debug("Order retrieving failed, connectivity issues?")
						return Promise.reject(new Error('Status could not be retrieved.'));
					}
					else {
						this.debug("Order_status has changed! Changing tokens, settings and firing the trigger accordingly.")
						if (orderEvent["event"] == 'groceries_ordered') {
							this.debug("Order changed to groceries_ordered, firing trigger")
							const eta_start = orderEvent["eta1_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							const eta_end = orderEvent["eta1_end"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							const eta_date = orderEvent["eta1_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[0]
							const price = orderEvent["price"]

							const data = { 'price': price,  'eta_start': eta_start, 'eta_end': eta_end, 'eta_date': eta_date}
							
							this._groceriesOrderedTrigger.trigger(data)

							this.orderPrice.setValue(price)
							this.orderStatus.setValue("groceries_ordered")
							this.orderDeliveryDate.setValue(eta_date)
							this.orderDeliveryStartWindow.setValue(eta_start)
							this.orderDeliveryEndWindow.setValue(eta_end)

							this.homey.settings.set("order_status", "groceries_ordered")
							this.homey.settings.set("order_price", price)
							this.homey.settings.set("delivery_eta_start", eta_start)
							this.homey.settings.set("delivery_eta_end", eta_end)
							this.homey.settings.set("delivery_date", eta_date)
							
							this.debug("Updating poll interval to "+ORDERED_POLL_INTERVAL/1000/60+" minutes");
							this.homey.app.changeInterval(ORDERED_POLL_INTERVAL);
						}
						else if (orderEvent["event"] == 'delivery_announced') {
							this.debug("Order changed to delivery_announced, firing trigger")
							const eta2_start = orderEvent["eta2_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							const eta2_end = orderEvent["eta2_end"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							const eta_date = orderEvent["eta2_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[0]

							const eta = { 'eta_start': eta2_start, 'eta_end': eta2_end, 'eta_date': eta_date }

							this._deliveryAnnouncedTrigger.trigger(eta)

							this.orderStatus.setValue("delivery_announced")
							this.orderDeliveryDate.setValue(eta_date)
							this.orderDeliveryStartWindow.setValue(eta2_start)
							this.orderDeliveryEndWindow.setValue(eta2_end)
						
							this.homey.settings.set("order_status", "delivery_announced")
							this.homey.settings.set("delivery_eta_start", eta2_start)
							this.homey.settings.set("delivery_eta_end", eta2_end)
							this.homey.settings.set("delivery_date", eta_date)

							this.debug("30 minutes before delivery we will increase polling interval");
							this.createDeliverySchedule(eta2_start, eta2_end);

							this.debug("Until that time, using ORDERED interval");
							this.homey.app.changeInterval(ORDERED_POLL_INTERVAL);

						}
						else if (orderEvent["event"] == 'groceries_delivered') {
							this.debug("Order changed to groceries_delivered, firing trigger")

							this._groceriesDelivered.trigger()

							this.orderStatus.setValue("groceries_deliverd")
							this.orderPrice.setValue(0)
							this.orderDeliveryDate.setValue("")
							this.orderDeliveryStartWindow.setValue("")
							this.orderDeliveryEndWindow.setValue("")

							this.homey.app.changeInterval(DEFAULT_POLL_INTERVAL);
							
							this.homey.settings.set("order_status", "groceries_delivered")
							this.homey.settings.unset("delivery_date")
							this.homey.settings.unset("delivery_eta_start")
							this.homey.settings.unset("delivery_eta_end")
						}
					}
				})
				.catch (error => {
					if ( error == "Error: unauthorized" ) {
						this.debug("ERROR: unauthorized, trying to retrieve new auth token.")
						this.login(this.homey.settings.get('username'), this.homey.settings.get('password'), function(callback) {
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
						this.debug("ERROR: "+error)
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
		this.debug("Changing polling interval to: "+interval/1000/60+" minutes");
		clearInterval(runningInterval);
		runningInterval = setInterval(this.pollOrder.bind(this), interval);
	}

	createDeliverySchedule(eta_start, eta_end) {
		const deliveryStartMin30 = new Date(new Date(eta_start) - 1000*60*30);
		this.debug("Increasing poll rate at " + deliveryStartMin30.toString())
		
		// scheduling increase of the polling rate 30min before the delivery time 
		schedule.scheduleJob(deliveryStartMin30, () => {
			this.homey.app.changeInterval(DELIVERY_POLL_INTERVAL);
		});
		
		// schedule beginning of delivery window trigger
		schedule.scheduleJob(new Date(eta_start), () => {
			this.homey.app._deliveryAnnouncedTriggerBeginTime.trigger()
		});
		
		// schedule ending of delivery window trigger
		schedule.scheduleJob(new Date(eta_end), () => {
			this.homey.app._deliveryAnnouncedTriggerEndTime.trigger()
		});
	}

	async login(username, password) {
		var post_data = {
			key: username,
			secret: md5(password),
			client_id: 1
		};

		var json_data = JSON.stringify(post_data)

		var options = {
			hostname: 'gateway-prod.global.picnicinternational.com',
			port: 443,
			path: '/api/14/user/login',
			method: 'POST',
			timeout: 1000,
			headers: {
				"User-Agent": "okhttp/3.9.0",
				"Content-Type": "application/json; charset=UTF-8",
				"client_id": "10100",
				"device_id": "open.app.picnic.homey"
			}
		}
		
		return new Promise((resolve) => {
			const req = http.request(options, (res) => {
				if (res.statusCode == 200) {
				this.homey.settings.set("x-picnic-auth", res.headers['x-picnic-auth'])
				this.homey.settings.set("username", username)
				this.homey.settings.set("password", password)
					this.pollOrder();
					resolve("success");
				}
				else {
					this.debug("ERROR: Authentication failed.")
					this.homey.app.changeInterval(DEFAULT_POLL_INTERVAL);
					resolve('Problem with request or authentication failed.');
				}
			});

			req.on('error', (e) => {
				this.debug("ERROR: Problem with request or authentication failed.")
				resolve('Problem with request or authentication failed.');
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

	async getStatus () {
		var options = {
			hostname: 'storefront-prod.nl.picnicinternational.com',
			port: 443,
			path: '/api/14/cart',
			method: 'GET',
			timeout: 1000,
			headers: {
				"User-Agent": "okhttp/3.9.0",
				"Content-Type": "application/json; charset=UTF-8",
				"x-picnic-auth": this.homey.settings.get("x-picnic-auth"),
				"x-picnic-did": "open.app.picnic.homey"
			}
		}
		return new Promise((resolve) => {
			const req = http.request(options, (res) => {
				if (res.statusCode == 200) {
					resolve("OK");
				}
				else {
					resolve("NOT OK");
				}
			});
	
			req.on('error', () => {
				resolve("NOT OK");
			});

			req.end();
		});
	}
	async getOrderStatus () {
		return new Promise((resolve, reject) => {
		   this.utils.getOrderStatus().then(content => {
			if (DEBUG) {
				this.debug("Order info received, raw json:")
				//this.debug(this.homey.settings.get("x-picnic-auth"))
				this.debug(content)
			}
			if (typeof content == 'undefined') return reject("No content received");
	
			if (JSON.parse(content)[0] != undefined)
			{
				if (JSON.parse(content)[0]["delivery_time"] != undefined && this.homey.settings.get("order_status") != "groceries_delivered")
				{
					this.debug("Retrieved new order status from Picnic: groceries_delivered, old order status was: "+this.homey.settings.get("order_status"))
					return resolve({ "event": "groceries_delivered" })
				}
				else if (JSON.parse(content)[0]["delivery_time"] == undefined && JSON.parse(content)[0]["eta2"] != undefined && this.homey.settings.get("order_status") != "delivery_announced")
				{
				  	this.debug("Retrieved new order status from Picnic: delivery_announced, old order status was: "+this.homey.settings.get("order_status"))
					return resolve({ "event": "delivery_announced", "eta2_start": JSON.parse(content)[0]["eta2"]["start"], "eta2_end": JSON.parse(content)[0]["eta2"]["end"] })
	
				}
				else if (JSON.parse(content)[0]["delivery_time"] == undefined && JSON.parse(content)[0]["eta2"] == undefined && this.homey.settings.get("order_status") != "groceries_ordered")
				{
					this.debug("Retrieved new order status from Picnic: groceries_ordered, old order status was: "+this.homey.settings.get("order_status"))
					var total_amount = 0;
					JSON.parse(content)[0]["orders"].forEach(function(order){ total_amount=total_amount+order["total_price"] });
					return resolve({ "event": "groceries_ordered", "price": total_amount/100, "eta1_start": JSON.parse(content)[0]["slot"]["window_start"], "eta1_end": JSON.parse(content)[0]["slot"]["window_end"] })
				}
				else
				{
				  this.debug("Order status did not change, current order status: "+this.homey.settings.get("order_status"))
				}
			}
			else if (JSON.parse(content).length == 0 && this.homey.settings.get("order_status") != "groceries_delivered" && this.homey.settings.get("order_status") != undefined){
				this.debug("No order found, considering this as delivered. Old order status was: "+this.homey.settings.get("order_status"))
				return resolve({ "event": "groceries_delivered"})
			}
		})
		.catch(error => {
			this.debug("ERROR: Order retrieval failed")
		  	reject(error)
		})
	  })
	};
}

module.exports = Picnic;
