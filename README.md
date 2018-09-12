### Picnic app for Homey

Doing your groceries at Picnic via Homey.

#### Flow Triggers:
Polling the status of your Picnic account every 5 minutes and firing on the following events:

- Groceries have been ordered.
  - Token: price (in euro), eta_begin & eta_end (60 minutes delivery timespan)
- Your groceries will be delivered soon (announcement of the 20min delivery timespan).
  - Token: eta_begin & eta_end
- Your groceries have been delivered.

#### Flow Actions:
Adding a product to your basket based on the name of the product passed as an argument.

#### Speech triggers:
##### English
<b>Trigger:</b> Add (a) product<br>
<b>Response:</b> Which product would you like to add?<br>
<b>Argument:</b> <'name your product'>

##### Dutch
<b>Trigger:</b> Voeg (een) product toe<br>
<b>Response:</b> Welk product wil je toevoegen?<br>
<b>Argument:</b> <'naam van het product'>

#### TODO:
- Add speech command to remove last added product by Homey

### Donate
Feel free to donate if you like the app :-)

[![Paypal donate][pp-donate-image]][pp-donate-link]

[pp-donate-link]: https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=SGUF7AJYAF83C
[pp-donate-image]: https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif
