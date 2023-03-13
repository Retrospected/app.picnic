'use strict';

const https = require('https')
const BaseClass = require('./baseclass.js')

class utils extends BaseClass {
  constructor({homey}) {
    super();
    this.homey = homey;
  }

  getOrderStatus() {
    return new Promise((resolve, reject) => {
      this.homey.app.debug("Building request")

      var options = {
        hostname: 'storefront-prod.nl.picnicinternational.com',
        path: '/api/14/deliveries/summary',
        port: 443,
        method: 'POST',
        timeout: 5000,
        headers: {
          "User-Agent": "okhttp/3.9.0",
          "Content-Type": "application/json; charset=UTF-8",
          "x-picnic-auth": this.homey.settings.get("x-picnic-auth"),
          "x-picnic-did": "open.app.picnic.homey"
        }
      }

      var req = https.request(options, function (res) {

        var content = "";

        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          content += chunk
        });

        res.on('end', () => {
          if (res.statusCode == 401) reject("Error: unauthorized");
          resolve(content)
        });
      }).on('error', (e) => {
        this.log("Error thrown while obtaining order status");
        this.log(e);
      });

      req.write('["CURRENT"]');
      req.end();
    });
  }
}

module.exports = utils;