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

## Dashboard Widget
A "Delivery" widget for Homey Dashboards, which shows the one thing a screen on
the wall is good at telling you: when the groceries turn up.

- An order that has been placed is a pending order, "Lopende bestelling" as
  Picnic calls it: it shows the day and the slot Picnic will deliver in,
  counting down towards it, and once Picnic announces the twenty minute
  delivery window, towards that
- Once the van is on the road, and only then, it says the groceries are on
  their way, counting down to Picnic's live window, with a bar that fills from
  the moment the van left until the end of that window
- During the window it says the groceries are arriving, after it that Picnic is
  running late and by how much, and afterwards the time they were delivered.
  Four hours later the delivery makes way for whatever is in your cart by then
- Once Picnic has counted what went back with the driver, the delivered order
  says what came back in deposit, and in what
- The amount of the order is shown alongside it, which can be turned off in the
  widget's settings. Once Picnic has settled a delivery, the amount is what was
  taken from your account: the order less refunds and the deposit that went back
- While an order can still be added to, the widget says until when. In the last
  hour before it closes that becomes a countdown in minutes. Picnic closes an
  order at 13:00 the day before a morning delivery and at 23:00 the day before
  a later one, which the app works out for itself when Picnic does not say
- Anything in your cart while an order is open still has to be added to that
  order, so the widget says how much that is and how long is left to do it
- With nothing ordered at all, the widget shows what is in your cart and how
  many products that is, and leads with how much is missing when that is
  below the minimum order value, since nothing can be ordered until it is
- It says your cart is still to order, and which delivery moment it is set
  to, or asks you to pick one: until you do, nothing is held for you. Once one
  is picked, the deadline to order by is what the widget leads with, counted
  down in minutes over the last hour
- With nothing planned, and with a cart that has no slot, it says when
  something could be delivered: how many of the next day's slots are still
  open, and the window of the first of those. A slot you picked while your
  basket is still empty is shown instead, with the deadline to order by
- A late delivery says how many minutes late it is
- When the app has not been able to reach Picnic in over a day, the widget says
  so and when it last heard, rather than passing off what it knew as news
- It has Picnic asked for the latest when it opens, when it comes back into
  view and when you tap it, so a cart filled in Picnic's app shows within
  seconds. Picnic is asked at most once every half minute however often that
  happens, and otherwise every five minutes while a dashboard shows the widget

Picnic's mark sits at the top left of every tile, the state's icon and name
next to it, and each colour means one thing: red is Picnic and a cart still to
order, ochre a deadline within the hour, green an order in hand or delivered.

Nothing on the widget is ever counted down in seconds: a dashboard is read in
passing, and the minute it arrives in is as precise as that reading gets.

The widget needs Homey firmware v12.3.0 or newer, which is what the SDK
documentation requires of an app containing a widget. What is still left to
verify about it is written down in [VERIFICATION.md](VERIFICATION.md), and
what is known about the Picnic calls behind it in
[docs/picnic-api.md](docs/picnic-api.md).

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

## Developing

Install the Homey CLI once, and log in to the Homey you want to develop
against:

```
npm install -g homey
homey login
```

Then, from a clone of this repository:

```
make run
```

That is the whole thing. It installs the app's dependencies if they are not
there and starts the app on your Homey, which runs until you stop it. `make` on
its own lists the rest:

| | |
| --- | --- |
| `make run` | Run the app on your Homey, until you stop it |
| `make run-clean` | Run it after deleting the stored data. See the warning below |
| `make install` | Install the app on your Homey, where it stays after the CLI is closed |
| `make test` | The unit tests, which need nothing but Node and no dependencies at all |
| `make lint` | Check every file against [.editorconfig](.editorconfig) |
| `make validate` | Validates the app the way the App Store does, without the CLI and without a Homey |
| `make compose` | Regenerate `app.json` from `.homeycompose` and the widgets |
| `make validate-cli` | The same validation, through the Homey CLI |
| `make gallery` | See the widget in every state in a browser. More on this below |
| `make previews` | Redraw the widget's preview images for the App Store |

Every one of those has an npm script that does the same, so without `make` on
your machine, Windows most likely, they are `npm start`,
`npm run start:clean`, `npm run install:homey`, `npm test`, `npm run lint`,
`npm run validate`, `npm run compose`, `npm run validate:cli`,
`npm run gallery` and `npm run previews`. Nothing here needs anything but Node
either way.

**`--clean` costs you your login.** It deletes the app's stored data, and this
app keeps your Picnic credentials, its session and the order it is following
there. After it you have to sign in again on the app's settings page, and
Picnic sends a new SMS code to do it. Use plain `make run` unless starting from
nothing is the point.

Neither `make` nor `npm` will let you get as far as the error a fresh clone
used to start with, which is the Homey CLI finding no dependencies to build
with and saying so in terms of npm:

```
✖ Command failed: npm ls --parseable --all --only=prod
npm error missing: md5@^2.2.1, required by app.picnic@3.7.0
```

If you do meet it, `npm install` is the whole fix.

`homey app run` regenerates `app.json` itself before it starts, so if `git
status` shows `app.json` changed after a run, the committed one was out of date
and the new one should be committed with your change.

While the app is running, the files under `widgets/delivery/public/` are served
straight from this folder. Editing the widget and reloading it on the dashboard
shows the change without restarting the app.

The widget can also be looked at without a Homey, in every state at once:

```bash
make gallery
```

serves a page with the widget's own code fed each of the states in
`test/support/widgetstates.js`, in both widths and both themes and either
language; edit the widget or the states and reload. Those same states go
through the widget in the tests, so a state that renders wrong is caught
there first. `make previews` redraws the two preview images in
`widgets/delivery/` from `scripts/previews.js`. That one needs `rsvg-convert`,
which comes with librsvg: `brew install librsvg` on macOS, `apt install
librsvg2-bin` on Debian or Ubuntu, `choco install rsvg-convert` on Windows.

## Formatting

[.editorconfig](.editorconfig) holds the formatting this repository agrees on:
LF line endings, a final newline, no trailing whitespace, two spaces to indent.
Most editors read it as they are, the rest have an
[EditorConfig plugin](https://editorconfig.org/#download), and nothing about it
is tied to a particular editor or operating system. `make lint` checks the same
rules with
[editorconfig-checker](https://github.com/editorconfig-checker/editorconfig-checker),
which reads `.editorconfig` itself so nothing is written down twice, and CI
runs it on every pull request, so a file that was written somewhere without the
plugin is caught rather than argued about. `.editorconfig-checker.json` holds
the two things the rules cannot say: the third party files in `settings/` are
skipped, and the indent width is not enforced on continuation lines.

Line endings are settled twice over: `.gitattributes` checks every text file
out as LF on every platform, Windows included, so the same bytes are in every
working tree.

## Changelog

Every release and what changed in it is in [CHANGELOG.md](CHANGELOG.md).

## Donate
Feel free to donate if you like the app :-)

[![Paypal donate][pp-donate-image]][pp-donate-link]

[pp-donate-link]: https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=SGUF7AJYAF83C
[pp-donate-image]: https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif
