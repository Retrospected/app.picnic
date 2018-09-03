const Homey = require('homey')
const http = require('https')

exports.init = function () {
  let actionAddProduct = new Homey.FlowCardAction('add_product')
  actionAddProduct.register().registerRunListener(( args, state ) => {
  Homey.app.log("Starting action with product: "+args['product'])
  Homey.app.log("With auth token: "+Homey.ManagerSettings.get("x-picnic-auth"))

  var callback = function () { searchItem(args, callback); }

})};
