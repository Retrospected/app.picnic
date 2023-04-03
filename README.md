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
- Your groceries will be delivered soon (announcement of the 20min delivery timeframe), with tokens:
  - eta date
  - eta begin, returning the begin of the 20 minutes delivery timeframe
  - eta end, returning the end of the 20 minutes delivery timeframe
- Start of the time frame when the delivery is announced
- End of the time frame when the delivery is announced
- Your groceries have been delivered

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

## CHANGELOG

### 3.2.4

- Updated Homey community URL

### 3.2.3

- Fixed typo in global token

### 3.2.2

- Bugfix to prevent unnecessary firing of triggers after update

### 3.2.1

- Bugfix in start and end window trigger

### 3.2.0

- Adding order condition

### 3.1.0

- Adding global Picnic tokens

### 3.0.3

- Improve the app description

### 3.0.2

- Bugfix in order delivered trigger, removed trigger tokens

### 3.0.1

- Bugfix order announced end time

### 3.0.0

- Migrate to SDK3

### 2.3.3

- Adding request header

### 2.3.2

- Fixing uncaught exception

### 2.3.0

- Updated order summary API
- Removed speech input code, no longer supported by Homey
- Improved polling intervals based on order status

### 2.2.5

- Changing readme files to comply with Athom's standards

### 2.2.4

- Fixing bug that would expire your session after 2 weeks

### 2.2.3

- Adding order existence check

### 2.2.2

- Fixed order retrieval

### 2.2.1

- Fixed stupid typo in the Dutch translation

### 2.2.0

- Added triggers for the begin and end of the announced time frame of delivery

### 2.1.6

- Fixing another README formatting issue

### 2.1.5

- Fixing README formatting issue

### 2.1.4

- Updates to pass certification

### 2.1.3

- Updating dependencies and removing deprecated "request" dependency
- Removing obsolete "http" dependency

### 2.0.5

- Updating dependencies

### 2.0.4

- Bugfixes, adding re-authentication fix and improving error handling

### 2.0.3

- Adding brand color (thanks to Veldkornet)

### 2.0.2

- Bugfix: Adding improved exception handling to prevent crashes

### 2.0.1

- Bugfix: Homey v2.0 support

### 1.5.1

- Bugfix: fixing minor issues

### 1.5.0

- Feature: Adding recipy management

### 1.4.4

- Bugfix: Adding exception handler when no products are found
- Bugfix: Encoding products including non-ASCII characters

### 1.4.3

- Bugfix: Picnic uses a server-side lock when items are being added to your cart. This caused an issue when running a flow that adds multiple items to your cart at the same time. Fixing this bug in 1.4.3 by using a threat lock stored in the app's ManagerSettings.

### 1.4.2

- Bugfix: Checking if the order status response actually contains content that can be parsed.

### 1.4.1

- Bugfix: Catching any errors during periodic polling of the order status.

### 1.4.0
<b>Note that after this update you will have to re-authenticate via the Picnic app settings.</b>

- Bugfix: Fixing bug to store credentials to the settings

### 1.3.0
<b>Note that after this update you will have to re-authenticate via the Picnic app settings.</b>

- Bugfix: session expires after about a month. To solve this the app now stores the username and password and retrieves a new session as soon as it is required

## Donate
Feel free to donate if you like the app :-)

[![Paypal donate][pp-donate-image]][pp-donate-link]

[pp-donate-link]: https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=SGUF7AJYAF83C
[pp-donate-image]: https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif
