'use strict';

const Homey = require('homey')
const utils = require('../utils.js')

exports.init = function () {
  let actionAddProduct = new Homey.FlowCardAction('add_product').register().registerRunListener(onAddProduct)

  let actionAddRecipy = new Homey.FlowCardAction('add_recipy');
  actionAddRecipy
  .registerRunListener(onAddRecipy)
  .register()
  .getArgument('recipy')
  .registerAutocompleteListener(( query, args ) => {
    var recipies = []
    Homey.ManagerSettings.get("recipies").forEach(function(item, index) {
      var recipy = {}
      recipy["name"] = Homey.ManagerSettings.get("recipies")[index]["name"];
      recipy["ingredients"] = Homey.ManagerSettings.get("recipies")[index]["ingredients"];
      recipies.push(recipy);
    })
    Homey.app.log(recipies);
    return Promise.resolve(recipies);
  });
  let actionAddRandomRecipy = new Homey.FlowCardAction('add_random_recipy').register().registerRunListener(onAddRandomRecipy)
};

function onAddRandomRecipy(args, callback) {
  var recipies = Homey.ManagerSettings.get("recipies");
  if (recipies === undefined || recipies === null || recipies.length < 1) {
    return Promise.resolve(false);
  }

  var randomRecipy = recipies[Math.floor(Math.random()*recipies.length)];
  Homey.app.log("Grabbing random recipy: "+randomRecipy["name"])

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

function onAddProduct(args) {
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

async function onAddRecipy(args) {
  var ingredients;
  for (var i = 0; i < Homey.ManagerSettings.get("recipies").length; i++) {
      if (Homey.ManagerSettings.get("recipies")[i]["name"] === args["recipy"]["name"] ) {
          ingredients = Homey.ManagerSettings.get("recipies")[i]["ingredients"];
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
