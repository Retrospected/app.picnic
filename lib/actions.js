'use strict';

const utils = require('./utils.js')
const BaseClass = require('./baseclass.js')

class actions extends BaseClass {

  constructor(...props) {
    super(...props);
    this.homey = null;
    this.utils = null;
    this.unifi = null;
  }

  setHomeyObject(homey) {
      this.homey = homey;
  }

  async onInit() {
    this.utils = new utils();
		this.utils.setHomeyObject(this.homey);

    this.homey.flow.getActionCard('add_product').registerRunListener(this.onAddProduct)

    this.homey.flow.getActionCard('add_recipy')
    .registerRunListener(this.onAddRecipy)
    .getArgument('recipy')
    .registerAutocompleteListener(( query, args ) => {
      var recipies = []
      this.homey.settings.get("recipies").forEach(function(item, index) {
        var recipy = {}
        recipy["name"] = this.homey.settings.get("recipies")[index]["name"];
        recipy["ingredients"] = this.homey.settings.get("recipies")[index]["ingredients"];
        recipies.push(recipy);
      })
      this.log(recipies);
      return Promise.resolve(recipies);
    });
    this.homey.flow.getActionCard('add_random_recipy').registerRunListener(this.onAddRandomRecipy)
  }

  async onAddRandomRecipy(args, callback) {
    var recipies = this.homey.settings.get("recipies");
    if (recipies === undefined || recipies === null || recipies.length < 1) {
      return Promise.resolve(false);
    }
  
    var randomRecipy = recipies[Math.floor(Math.random()*recipies.length)];
    this.log("Grabbing random recipy: "+randomRecipy["name"])
  
    let recept = randomRecipy["ingredients"].map(item => {
      return new Promise((resolve) => {
        this.searchItem(item, function(productId) {
          if ( productId instanceof Error ) { return resolve(false); }
          this.addItemToCart(productId, function(result) {
            if ( result instanceof Error ) {
              return resolve(false)
            }
            resolve(true);
          });
        });
      });
    });
    return Promise.all(recept);
  }
  async poep(abc){
    console.log("JUU"+abc)
  }
  async onAddProduct(args) {
    return new Promise((resolve, reject) => {
      // cannot read properties of null (reading 'searchItem')
      this.searchItem(args["product"], function(productId) {
        console.log("1")
        if ( productId instanceof Error ) { return resolve(false); }
        this.addItemToCart(productId, function(result) {
          if ( result instanceof Error ) {
            return resolve(false);
          }
          else {
            resolve(true)
          }
        });
      });
    });
  }
  
  async onAddRecipy(args) {
    var ingredients;
    for (var i = 0; i < this.homey.settings.get("recipies").length; i++) {
        if (this.homey.settings.get("recipies")[i]["name"] === args["recipy"]["name"] ) {
            ingredients = this.homey.settings.get("recipies")[i]["ingredients"];
        }
    }
  
    let recept = ingredients.map(item => {
      return new Promise((resolve) => {
        this.searchItem(item, function(productId) {
          if ( productId instanceof Error ) { return resolve(false); }
          this.addItemToCart(productId, function(result) {
            if ( result instanceof Error ) {
              return resolve(false)
            }
            resolve(true);
          });
        });
      });
    });
    return Promise.all(recept);
  }

  async searchItem(data,callback) {
    console.log("2")
    var options = {
      hostname: 'storefront-prod.nl.picnicinternational.com',
      port: 443,
      path: '/api/14/search/?search_term='+encodeURIComponent(data.split(' ').join('+')),
      method: 'GET',
      timeout: 5000,
      headers: {
        "User-Agent": "okhttp/3.9.0",
        "Content-Type": "application/json; charset=UTF-8",
        "x-picnic-auth": this.homey.settings.get("x-picnic-auth"),
        "x-picnic-did": "open.app.picnic.homey"
      }
    }
    this.homey.app.log("* Searching items to cart")
    this.homey.app.log("Searching "+options["path"])
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
        this.homey.app.log("Processing: "+productId)
        if (typeof productId == 'undefined') { callback(new Error('Couldnt find item')); }
        return callback(productId);
      });
  
      req.on('error', (e) => {
        return callback(new Error('Couldnt find item'));
        });
      });
      req.end();
    }
  
    async addItemToCart(productId, callback) {
      while(true){
      await new Promise(resolve => {
        this.homey.app.log("Sleeping because of itemLock")
        setTimeout(resolve, 1000)
      })
  
      if(!this.homey.settings.get("additemLock")){
        break
      }
    }
  
    this.homey.settings.set("additemLock", true)
    var json_data = '{"count":1,"product_id":'+productId+'}'
    this.homey.app.log("* Adding items to cart")
    this.homey.app.log("Sending json:")
    this.homey.app.log(json_data)
    var options = {
      hostname: 'storefront-prod.nl.picnicinternational.com',
      port: 443,
      path: '/api/14/cart/add_product',
      method: 'POST',
      timeout: 5000,
      headers: {
        "User-Agent": "okhttp/3.9.0",
        "Content-Type": "application/json; charset=UTF-8",
        "x-picnic-auth": this.homey.settings.get("x-picnic-auth"), 
        "x-picnic-did": "open.app.picnic.homey"
      }
    }
  
    var body = ""
    var req = https.request(options, function (res) {
  
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk
      });
  
      res.on('end', function() {
        this.homey.settings.set("additemLock", false)
        this.homey.app.log("Received server response")
  
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
          this.homey.settings.set("additemLock", false)
          callback(new Error('Couldnt add item'));
        });
      });
      req.write(json_data);
      req.end();
  }
}

module.exports = actions;