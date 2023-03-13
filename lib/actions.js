'use strict';

const utils = require('./utils.js')
const BaseClass = require('./baseclass.js')

class actions extends BaseClass {

  constructor({homey}) {
    super();
    this.homey = homey;
    //this.utils = new utils({homey: this.homey});
  }

  async onInit() {
    this.homey.app.debug("INIT Actions")

    this.homey.flow.getActionCard('add_product').registerRunListener(async (args) => {
      var product = args["product"]
      this.homey.app.debug("Running action add_product with args: "+product)

      this.homey.app.utils.searchItem(product, (productId) => {
          if ( productId instanceof Error ) { return false; }
          this.homey.app.utils.addItemToCart(productId, function(result) {
            if ( result instanceof Error ) {
              return false;
            }
            else {
              return true;
            }
          });
      });
    });

    this.homey.flow.getActionCard('add_recipy')
    .registerRunListener(async (args) => {

      for (var i = 0; i < this.homey.settings.get("recipies").length; i++) {
          if (this.homey.settings.get("recipies")[i]["name"] === args["recipy"]["name"] ) {
            let recept = this.homey.settings.get("recipies")[i]["ingredients"].map(item => {
              return new Promise((resolve) => {
                this.homey.app.utils.searchItem(item, (productId) => {
                  if ( productId instanceof Error ) { return resolve(false); }
                  this.homey.app.utils.addItemToCart(productId, function(result) {
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
      })
    .getArgument('recipy')
    .registerAutocompleteListener(( query, args ) => {
      var recipies = []
      this.homey.settings.get("recipies").forEach((item, index) => {
        var recipy = {}
        recipy["name"] = this.homey.settings.get("recipies")[index]["name"];
        recipy["ingredients"] = this.homey.settings.get("recipies")[index]["ingredients"];
        recipies.push(recipy);
      })
      return Promise.resolve(recipies);
    });

    this.homey.flow.getActionCard('add_random_recipy').registerRunListener(async (args) => {

      var recipies = this.homey.settings.get("recipies");
      if (recipies === undefined || recipies === null || recipies.length < 1) {
        return Promise.resolve(false);
      }
    
      var randomRecipy = recipies[Math.floor(Math.random()*recipies.length)];
      this.homey.app.debug("Grabbing random recipy: "+randomRecipy["name"])
    
      let recept = randomRecipy["ingredients"].map(item => {
        return new Promise((resolve) => {
          this.homey.app.utils.searchItem(item, (productId) => {
            if ( productId instanceof Error ) { return resolve(false); }
            this.homey.app.utils.addItemToCart(productId, function(result) {
              if ( result instanceof Error ) {
                return resolve(false)
              }
              resolve(true);
            });
          });
        });
      });
      return Promise.all(recept);

    });
  }
}

module.exports = actions;