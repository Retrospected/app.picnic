'use strict';

const Homey = require('homey')
const utils = require('../utils.js')

module.exports = class PicnicActions extends Homey.Driver {
  async onInit() {
    homey.flow.getActionCard('add_product').registerRunListener(onAddProduct)

    homey.flow.getActionCard('add_recipy')
    .registerRunListener(onAddRecipy)
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
    this.homey.flow.getActionCard('add_random_recipy').register().registerRunListener(onAddRandomRecipy)
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
        utils.searchItem(item, function(productId) {
          if ( productId instanceof Error ) { return resolve(false); }
          utils.addItemToCart(productId, function(result) {
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
  
  async onAddProduct(args) {
    return new Promise((resolve, reject) => {
      utils.searchItem(args["product"], function(productId) {
        if ( productId instanceof Error ) { return resolve(false); }
        utils.addItemToCart(productId, function(result) {
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
        utils.searchItem(item, function(productId) {
          if ( productId instanceof Error ) { return resolve(false); }
          utils.addItemToCart(productId, function(result) {
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
}
