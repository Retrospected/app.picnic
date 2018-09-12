'use strict';

const Homey = require('homey')
const utils = require('../utils.js')

exports.init = function () {

  Homey.ManagerSpeechInput.on('speechEval', function( speech, callback ) {
  		callback( null, true );
  });

  Homey.ManagerSpeechInput.on('speechMatch', function( speech, onSpeechEvalData ) {
    speech.ask(Homey.__('speech.which_product'))
    .then( function(result) {
      utils.searchItem(result, function(productId) {
        if ( productId instanceof Error ) { return Promise.reject(new Error('Item not found')); }
        utils.addItemToCart(productId, function(result) {
          if ( result instanceof Error ) { return Promise.reject(new Error('Item could not be added')); }
          speech.say(Homey.__('speech.pre_added') +' '+ result + ' ' + Homey.__('speech.post_added'))
        });
      })
    })
    .catch( err => {
      return new Error('Speech failed');
    })
  })
}
