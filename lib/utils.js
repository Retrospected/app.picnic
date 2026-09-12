'use strict';

const https = require('https')
const BaseClass = require('./baseclass.js')
const { parseAddProductResponse } = require('./cartresponse.js')
const { PICNIC_AGENT, PICNIC_DID } = require('./picnicheaders.js')
const { toError, describeBody } = require('./errors.js')

// the code that marks the one failure the poll reacts to by logging in again
const UNAUTHORIZED = 'PICNIC_UNAUTHORIZED'

class utils extends BaseClass {
  constructor({ homey }) {
    super();
    this.homey = homey;
  }

  getOrderStatus() {
    return new Promise((resolve, reject) => {
      this.homey.app.debug("Building request")

      var options = {
        hostname: this.homey.settings.get("url"),
        path: '/api/15/deliveries/summary',
        port: 443,
        method: 'POST',
        timeout: 5000,
        headers: {
          "User-Agent": "okhttp/3.9.0",
          "Content-Type": "application/json; charset=UTF-8",
          "x-picnic-auth": this.homey.settings.get("x-picnic-auth"),
          "x-picnic-did": PICNIC_DID,
          "x-picnic-agent": PICNIC_AGENT
        }
      }

      var req = https.request(options, (res) => {

        var content = "";

        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          content += chunk
        });

        res.on('end', () => {
          if (res.statusCode == 401) {
            // still reads as "Error: unauthorized" for the poll to compare
            // against; the properties are what tell it apart in a report
            const unauthorized = new Error("unauthorized");
            unauthorized.statusCode = res.statusCode;
            unauthorized.code = UNAUTHORIZED;
            return reject(unauthorized);
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            // a refusal used to be read as order info and fail as a parse error
            const refused = new Error("Picnic refused to hand out the order: " + describeBody(content));
            refused.statusCode = res.statusCode;
            return reject(refused);
          }

          resolve(content)
        });
      }).on('error', (e) => {
        // without rejecting, a failed request left the poll hanging and said
        // nothing about it, so a connectivity problem looked like a quiet app
        reject(toError(e, "Retrieving the order from " + options.hostname + " failed"));
      });

      req.on('timeout', () => {
        // a socket timeout does not end the request by itself
        req.destroy(new Error("Picnic did not answer within " + options.timeout + "ms"));
      });

      req.write('["CURRENT"]');
      req.end();
    });
  }

  async searchItem(data, callback) {
    this.homey.app.debug("Searching product in the store")
    var options = {
      hostname: this.homey.settings.get("url"),
      port: 443,
      path: '/api/15/pages/search-page-results?search_term=' + encodeURIComponent(data.split(' ').join('+')),
      method: 'GET',
      timeout: 5000,
      headers: {
        "User-Agent": "okhttp/3.9.0",
        "Accept": "application/json; charset=UTF-8",
        "x-picnic-auth": this.homey.settings.get("x-picnic-auth"),
        "x-picnic-did": PICNIC_DID,
        "x-picnic-agent": PICNIC_AGENT
      }
    }
    this.homey.app.debug("* Searching items to cart")
    this.homey.app.debug("Searching " + options["path"])
    this.homey.app.debug("With request headers:")
    for (const [key, value] of Object.entries(options.headers)) {
      this.homey.app.debug(`${key}: ${value}`);
    }
    var body = ""
    var self = this;

    var req = https.request(options, function (res) {

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk
      });

      res.on('end', function () {
        try {
          self.homey.app.debug("Raw search results:")
          self.homey.app.debug(JSON.stringify(body))
          var analyticsContexts = JSON.parse(body)["body"]["child"]["analytics"]["contexts"]
          var productContext = analyticsContexts.find(c => c["data"] && c["data"]["product_ids"])
          var productIdData = productContext && productContext["data"]["product_ids"]
          var productId;
          if (Array.isArray(productIdData)) {
            productId = productIdData[0];
          } else if (productIdData && productIdData.type === "EXPRESSION" && typeof productIdData.expression === 'string') {
            var expressionMatch = productIdData.expression.match(/return (\["[^"]*"(?:,"[^"]*")*\])/)
            productId = expressionMatch ? JSON.parse(expressionMatch[1])[0] : undefined;
          }
          if (typeof productId == 'undefined') { return callback(new Error("Couldn't find item")); }
          return callback(productId);
        } catch (error) {
          return callback(new Error("Couldn't find item"));
        }
      });
    }).on('error', (e) => {
      self.homey.app.debug("ERROR: " + e.message)
      return callback(new Error("Couldn't find item"));
    });
    req.end();
  }

  async addItemLock() {
    return new Promise(resolve => {
      const intervalId = setInterval(() => {
        if (!this.homey.settings.get("additemLock")) {
          clearInterval(intervalId);
          resolve();
        } else {
          this.homey.app.debug("Sleeping because of itemLock");
        }
      }, 1000);
    });
  }

  async addItemToCart(productId, callback) {

    await this.addItemLock();

    this.homey.settings.set("additemLock", true)
    var json_data = '{"count":1,"product_id":"' + productId + '"}'
    this.homey.app.debug("* Adding items to cart")
    this.homey.app.debug("Sending json:")
    this.homey.app.debug(json_data)
    var options = {
      hostname: this.homey.settings.get("url"),
      port: 443,
      path: '/api/15/cart/add_product',
      method: 'POST',
      timeout: 5000,
      headers: {
        "User-Agent": "okhttp/3.9.0",
        "Content-Type": "application/json; charset=UTF-8",
        "x-picnic-auth": this.homey.settings.get("x-picnic-auth"),
        "x-picnic-did": PICNIC_DID,
        "x-picnic-agent": PICNIC_AGENT
      }
    }

    var body = ""
    var req = https.request(options, (res) => {

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk
      });

      res.on('end', () => {
        this.homey.settings.set("additemLock", false)
        this.homey.app.debug("Received server response")

        const outcome = parseAddProductResponse(body, productId);

        if (outcome["name"] !== undefined) {
          return callback(outcome["name"]);
        }

        this.homey.app.debug("Adding the product did not work: " + outcome["error"]
          + (outcome["code"] ? ", error code " + outcome["code"] : "")
          + (outcome["reason"] ? ", " + outcome["reason"] : ""))
        this.homey.app.debug("Raw response: " + body)

        return callback(new Error(outcome["error"]));
      });
    }).on('error', (e) => {
      // the lock is released when a response arrives, so a request that never
      // gets one has to release it here or every later add product action
      // waits on a lock nothing will ever open
      this.homey.settings.set("additemLock", false)
      this.homey.app.debug("Adding the product failed: " + e.message)
      callback(new Error("Couldn't add item"));
    });
    req.write(json_data);
    req.end();
  }
}

module.exports = utils;
module.exports.UNAUTHORIZED = UNAUTHORIZED;