Doing your groceries at Picnic via Homey.

Flow Triggers:
Polling the status of your Picnic account every 5 minutes and providing trigger flowcards based on the following events:

- Groceries have been ordered, with tokens:
  - price (in euro)
  - eta date
  - eta begin, returning the begin of the 60 minutes delivery timeframe
  - eta end, returning the end of the 60 minutes delivery timeframe
- Your groceries will be delivered soon (announcement of the 20min delivery timeframe), with tokens:
  - eta date
  - eta begin, returning the begin of the 20 minutes delivery timeframe
  - eta end, returning the end of the 20 minutes delivery timeframe
- Your groceries have been delivered, with tokens:
  - delivery date
  - delivery time

Flow Actions:
- Adding a product to your basket based on the name of the product passed as an argument.
- Adding products based on a recipe as configured via the settings page.
- Adding products based on a randomly picked recipe.

Speech triggers:
English
Trigger: Add (a) product
Response: Which product would you like to add?
Argument: 'name your product'

Dutch
Trigger: Voeg (een) product toe
Response: Welk product wil je toevoegen?
Argument: 'naam van het product'
