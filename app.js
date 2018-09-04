'use strict';

const Homey = require('homey');
const flowSpeech = require('./lib/flow/speech.js')
var http = require("https");
var md5 = require("md5")

Homey.ManagerSpeechInput.on('speechEval', function( speech, callback ) {
		//Homey.app.log(speech)
		callback( null, true );
});

class Picnic extends Homey.App {

	onInit() {
		this.log('Picnic is running...');

		flowSpeech.init()
	}

	login(args, callback) {
		var post_data = {
			key: args.body.username,
			secret: md5(args.body.password),
			client_id: 1
		};

		var json_data = JSON.stringify(post_data)

		var options = {
			// uri: https://gateway-prod.global.picnicinternational.com/api/14/user/login
			hostname: 'gateway-prod.global.picnicinternational.com',
			port: 443,
			path: '/api/14/user/login',
			method: 'POST',
			timeout: 1000,
			headers: {
				"User-Agent": "okhttp/3.9.0",
				"Content-Type": "application/json; charset=UTF-8"
			}
		}


		const req = http.request(options, (res) => {
			if (res.statusCode == 200) {
				Homey.ManagerSettings.set("x-picnic-auth", res.headers['x-picnic-auth'])
				return callback(null, "success")
			}
			else {
				return callback(new Error('Problem with request or authentication failed.'));
			}

			req.on('error', (e) => {
				return callback(new Error('Problem with request or authentication failed.'));
			});
		});

		req.write(json_data);
		req.end();
	}
}

module.exports = Picnic;
