# Picnic app for Homey

Connect Picnic with Homey.

Add individual items or multiple items based on a recipy to your shopping cart. Or trigger flows based on the different states of your order.

## Instructions

After installing the app, login using your Picnic account via the app settings. Here you can also add your favorite recipes.

## Flow Triggers
Polling the status of your Picnic account and providing trigger flowcards based on the following events:

- Groceries have been ordered, with tokens:
  - price (in euro)
  - eta date
  - eta begin, returning the begin of the 60 minutes delivery timeframe
  - eta end, returning the end of the 60 minutes delivery timeframe
- Delivery time has been announced (Picnic published the 20min delivery timeframe, usually several hours before the delivery itself), with tokens:
  - eta date
  - eta begin, returning the begin of the 20 minutes delivery timeframe
  - eta end, returning the end of the 20 minutes delivery timeframe
- Your groceries will be delivered soon, a configurable number of minutes (30 by default) before the delivery timeframe starts, with the same tokens
- Start of the time frame when the delivery is announced, with the same tokens
- End of the time frame when the delivery is announced, with the same tokens
- Your groceries have been delivered, with tokens:
  - eta date
  - eta begin and eta end of the timeframe the delivery was expected in
  - delivery time, the moment the groceries were actually delivered. Picnic usually drops a finished delivery from its response without saying when it arrived, in which case this is the moment the app noticed

## Flow Actions
- Adding a product to your basket based on the name of the product passed as an argument.
- Adding products based on a recipe as configured via the settings page.
- Adding products based on a randomly picked recipe.

## Global Tokens
The following order specific global tokens are available:

- Order status
- Order costs
- Delivery status
- Start of the delivery window
- End of the delivery window

## Changelog

Every release and what changed in it is in [CHANGELOG.md](CHANGELOG.md).

## Donate
Feel free to donate if you like the app :-)

[![Paypal donate][pp-donate-image]][pp-donate-link]

[pp-donate-link]: https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=SGUF7AJYAF83C
[pp-donate-image]: https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif
