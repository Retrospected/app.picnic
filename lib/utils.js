'use strict';

const Homey = require('homey')
const https = require('https')

module.exports.searchItem = function searchItem(data,callback) {
  var options = {
    hostname: 'storefront-prod.nl.picnicinternational.com',
    port: 443,
    path: '/api/14/search/?search_term='+encodeURIComponent(data.split(' ').join('+')),
    method: 'GET',
    timeout: 5000,
    headers: {
      "User-Agent": "okhttp/3.9.0",
      "Content-Type": "application/json; charset=UTF-8",
      "x-picnic-auth": Homey.ManagerSettings.get("x-picnic-auth")
    }
  }
  Homey.app.log("* Searching items to cart")
  Homey.app.log("Searching "+options["path"])
  var body = ""
  var req = https.request(options, function (res) {

    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      body += chunk
    });

    res.on('end', function() {
      var jsonBody = JSON.parse(body)[0]
      if (jsonBody === undefined || jsonBody["items"] === undefined || jsonBody["items"].length == 0) {
        return callback(new Error('Couldnt find item'));
      }

      var productId = jsonBody["items"][0]["id"]
      Homey.app.log("Processing: "+productId)
      if (typeof productId == 'undefined') { callback(new Error('Couldnt find item')); }
      return callback(productId);
    });

    req.on('error', (e) => {
      return callback(new Error('Couldnt find item'));
    });
  });
  req.end();
}


module.exports.addItemToCart = async function addItemToCart (productId, callback) {

  while(true){
  await new Promise(resolve => {
    Homey.app.log("Sleeping because of itemLock")
    setTimeout(resolve, 1000)
  })

  if(!Homey.ManagerSettings.get("additemLock")){
    break
  }
}

  Homey.ManagerSettings.set("additemLock", true)
  var json_data = '{"count":1,"product_id":'+productId+'}'
  Homey.app.log("* Adding items to cart")
  Homey.app.log("Sending json:")
  Homey.app.log(json_data)
  var options = {
    hostname: 'storefront-prod.nl.picnicinternational.com',
    port: 443,
    path: '/api/14/cart/add_product',
    method: 'POST',
    timeout: 5000,
    headers: {
      "User-Agent": "okhttp/3.9.0",
      "Content-Type": "application/json; charset=UTF-8",
      "x-picnic-auth": Homey.ManagerSettings.get("x-picnic-auth")
    }
  }

  var body = ""
  var req = https.request(options, function (res) {

    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      body += chunk
    });

    res.on('end', function() {
      Homey.ManagerSettings.set("additemLock", false)
      Homey.app.log("Received server response")

      if (typeof JSON.parse(body)["items"] !== 'undefined' && JSON.parse(body)["items"]) {
        JSON.parse(body)["items"]
        .forEach(function (item) {
          if (item["items"][0]['id'] == productId) {
            return callback(item["items"][0]["name"])
          }
        })
      }
      else if (JSON.parse(body)["error"]["code"] === "UNPROCESSABLE_ENTITY") {
        callback(new Error('Cart was locked'));
      }
      else {
        callback(new Error('Couldnt add item'));
      }
    });

    req.on('error', (e) => {
      Homey.ManagerSettings.set("additemLock", false)
      callback(new Error('Couldnt add item'));
    });
  });
  req.write(json_data);
  req.end();
}

module.exports.getOrderStatus = function getOrderStatus() {
  return new Promise((resolve, reject) => {

    var options = {
      hostname: 'storefront-prod.nl.picnicinternational.com',
      path: '/api/15/deliveries',
      port: 443,
      method: 'POST',
      timeout: 5000,
      headers: {
        "User-Agent": "okhttp/3.9.0",
        "Content-Type": "application/json; charset=UTF-8",
        "x-picnic-auth": Homey.ManagerSettings.get("x-picnic-auth")
      }
    }

    var req = https.request(options, function (res) {

      var content = "";

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        content += chunk
      });

      res.on('end', () => {
        Homey.app.log("Order info received")
        if (res.statusCode != 200) return reject ("Error: unauthorized");
        if (typeof content == 'undefined') return reject("No content received");

        if (JSON.parse(content)[0] != undefined)
        {
            if (JSON.parse(content)[0]["delivery_time"] != undefined && Homey.ManagerSettings.get("order_status") != "order_delivered")
            {
                Homey.app.log("Retrieved status from picnic server: order_delivered")
                Homey.ManagerSettings.set("order_status", "order_delivered")

                return resolve({ "event": "groceries_delivered", "delivery_time": JSON.parse(content)[0]["delivery_time"]["end"] })
            }
            else if (JSON.parse(content)[0]["delivery_time"] == undefined && JSON.parse(content)[0]["eta2"] != undefined && Homey.ManagerSettings.get("order_status") != "order_announced")
            {
                Homey.app.log("Retrieved status from picnic server: order_announced")
                Homey.ManagerSettings.set("order_status", "order_announced")

                return resolve({ "event": "delivery_announced", "eta2_start": JSON.parse(content)[0]["eta2"]["start"], "eta2_end": JSON.parse(content)[0]["eta2"]["end"] })

            }
            else if (JSON.parse(content)[0]["delivery_time"] == undefined && JSON.parse(content)[0]["eta2"] == undefined && Homey.ManagerSettings.get("order_status") != "order_placed")
            {
                Homey.app.log("Retrieved status from picnic server: order_placed")
                Homey.ManagerSettings.set("order_status", "order_placed")
                var total_amount = 0;
                JSON.parse(content)[0]["orders"].forEach(function(order){ total_amount=total_amount+order["total_price"] });
                return resolve({ "event": "groceries_ordered", "price": total_amount/100, "eta1_start": JSON.parse(content)[0]["slot"]["window_start"], "eta1_end": JSON.parse(content)[0]["slot"]["window_end"] })
            }
            else
            {
                Homey.app.log("Order status didnt change, currently: "+Homey.ManagerSettings.get("order_status"))
            }
        }
      });
    }).on('error', (e) => {
      Homey.app.log("Error thrown while obtaining order status");
      Homey.app.log(e);
      return new Error('Problem with order status request failed.');
    });

    req.write('["CURRENT"]');
    req.end();
  });
}
