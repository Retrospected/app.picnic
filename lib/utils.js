'use strict';

const Homey = require('homey')
const http = require('https')

module.exports.searchItem = function searchItem(data,callback) {
  var options = {
    hostname: 'storefront-prod.nl.picnicinternational.com',
    port: 443,
    path: '/api/14/search/?search_term='+data,
    method: 'GET',
    timeout: 5000,
    headers: {
      "User-Agent": "okhttp/3.9.0",
      "Content-Type": "application/json; charset=UTF-8",
      "x-picnic-auth": Homey.ManagerSettings.get("x-picnic-auth")
    }
  }

  var body = ""
  var req = http.request(options, function (res) {

    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      body += chunk
    });

    res.on('end', function() {
      var productId = JSON.parse(body)[0]["items"][0]["id"]
      if (typeof productId == 'undefined') { callback(new Error('Couldnt find item')); }
      return callback(productId);
    });

    req.on('error', (e) => {
      callback(new Error('Couldnt find item'));
    });
  });
  req.end();
}


module.exports.addItemToCart = function addItemToCart (productId, callback) {

  var json_data = '{"count":1,"product_id":'+productId+'}'

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
  var req = http.request(options, function (res) {

    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      body += chunk
    });

    res.on('end', function() {
      JSON.parse(body)["items"]
      .forEach(function (item) {
        if (item["items"][0]['id'] == productId) {
          return callback(item["items"][0]["name"])
        }
      })
    });

    req.on('error', (e) => {
      callback(new Error('Couldnt add item'));
    });
  });
  req.write(json_data);
  req.end();
}


module.exports.getOrderStatus = function getOrderStatus(callback) {

  var options = {
    hostname: 'storefront-prod.nl.picnicinternational.com',
    port: 443,
    path: '/api/14/my_store?depth=0',
    method: 'GET',
    timeout: 60000,
    headers: {
      "User-Agent": "okhttp/3.9.0",
      "Content-Type": "application/json; charset=UTF-8",
      "x-picnic-auth": Homey.ManagerSettings.get("x-picnic-auth")
    }
  }

  var body = ""
  var req = http.request(options, function (res) {

    if (res.statusCode == 401) { return callback(new Error("unauthorized")) }

    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      body += chunk
    });

    res.on('end', function() {



      var content = JSON.parse(body)
      content["content"].forEach( function(item){
        if (item["id"] == "USER_ASSISTANT") {
          item["items"].forEach(function(subitem){
            if (subitem["payload"]["type"] == "ORDER") {
              var order_status = Homey.ManagerSettings.get("order_status")

              if (subitem["payload"]["eta1"] != null && subitem["payload"]["eta2"] == null && subitem["payload"]["delivery_time"] == null)
              {
                if (order_status != "order_placed") {
                  Homey.ManagerSettings.set("order_status", "order_placed")
                  return callback({ "event": "groceries_ordered", "price": subitem["payload"]["total_price"]/100, "eta1_start": subitem["payload"]["eta1"]["start"], "eta1_end": subitem["payload"]["eta1"]["end"] })
                }
              }
              else if (subitem["payload"]["eta2"] != null && subitem["payload"]["delivery_time"] == null) {
                if (order_status != "order_announced") {
                  Homey.ManagerSettings.set("order_status", "order_announced")
                  return callback({ "event": "delivery_announced", "eta2_start": subitem["payload"]["eta2"]["start"], "eta2_end": subitem["payload"]["eta2"]["end"] })
                }
              }
              else if (subitem["payload"]["delivery_time"] != null) {
                if (order_status != "order_delivered") {
                  Homey.ManagerSettings.set("order_status", "order_delivered")
                  return callback({ "event": "groceries_delivered", "delivery_time": subitem["payload"]["delivery_time"]["end"] })
                }
              }
            }
          });
        }
      });
    });

    req.on('error', (e) => {
      callback(new Error('Couldnt get status'));
    });
  });
  req.end();
}
