import BaseClass, { type PicnicHomey } from './baseclass';

// A recipe as the settings page stores it: a name, and what to search for.
interface Recipe {
  name: string;
  ingredients: string[];
}

export default class Actions extends BaseClass {

  constructor({homey}: { homey: PicnicHomey }) {
    super();
    this.homey = homey;
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
            let recept = this.homey.settings.get("recipies")[i]["ingredients"].map((item: string) => {
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
      var recipies: Recipe[] = []
      this.homey.settings.get("recipies").forEach((item: Recipe, index: number) => {
        var recipy = {} as Recipe
        recipy["name"] = this.homey.settings.get("recipies")[index]["name"];
        recipy["ingredients"] = this.homey.settings.get("recipies")[index]["ingredients"];
        recipies.push(recipy);
      })
      return Promise.resolve(recipies);
    });

    this.homey.flow.getActionCard('add_random_recipy').registerRunListener(async (args) => {

      var recipies: Recipe[] | null | undefined = this.homey.settings.get("recipies");
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
