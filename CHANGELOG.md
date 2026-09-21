# Changelog

All notable changes to the Picnic app for Homey, newest first. The short version of
each release is what Homey shows in the app store, and lives in `.homeychangelog.json`.

## 3.8.0

- A "Delivery" widget for Homey Dashboards. An order that has been placed shows the day and the slot it will be delivered in and counts down towards it; once Picnic announces the delivery moment the countdown is to that window, with a bar that fills as the delivery draws near. During the window it says the groceries are arriving, after it that Picnic is running late, and once they have been delivered it says at what time, for the six hours after
- The widget follows the app rather than the other way around: it is told about a new state as the poll finds it, counts the minutes down by itself in between, and counts them down on Homey's clock rather than on the clock of whatever is showing the dashboard
- The app now writes down when a delivery was announced and when it arrived. Neither was kept, and both are what the widget needs to say how far along a delivery is and whether the groceries came today
- The widget says until when an order can still be added to, and turns that into a countdown in minutes over the last hour before it closes. It is the one thing on a grocery dashboard that can still be acted on. Picnic closes an order at 13:00 the day before a delivery that starts in the morning and at 23:00 the day before one later in the day, and the app works that out from the delivery window itself, so the deadline is there whether or not Picnic mentions one
- Anything in the cart while an order is open is something that still has to be added to that order, and the widget says how much it is and how long is left to do it. After the deadline it stops bringing it up: there is nothing to be done about it by then
- With nothing ordered at all, the widget shows what is in the cart and how many products that is, so it has something to say on the days between deliveries. If the cart is below the minimum order value it says how much is missing
- Tapping the widget opens Picnic, with a short buzz to say the tap arrived. Both the cart and the tap can be turned off in the widget's settings
- The cart is only fetched while a dashboard is actually showing the widget, at most once every five minutes, and only while nothing is ordered
- The cart total on the widget is what Picnic's own app shows. Picnic works a cart out for the app version a client says it is, and this app said it was a version from years ago: its carts came back without BundelBonus deals and without the Family discount, up to tens of cents over. It now identifies as a current version
- Running the app with `make run` logs what Picnic answers, with personal details blanked out, for working out what a response holds. An installed app never does
- An order placed in the Picnic app reaches the widget within minutes rather than hours. Between deliveries the app only polled every six hours, so the widget went on saying nothing was planned while an order was open and its deadline to add to it ran out. While a dashboard shows the widget, Picnic is now asked about orders as often as about the cart, and a cart that empties is asked about right away, since that is what placing an order looks like
- An app that was not following an order no longer reports a delivery that never happened. Picnic is asked for current deliveries, and an empty answer used to be read as "the order I was following has just been delivered", stamped with the moment of the poll. On a fresh install, or the first poll after signing in between deliveries, that announced groceries nobody ordered: on the widget, and to every flow on the "groceries delivered" trigger
- The widget only shows a delivery it can place in time: one whose window it knows, or one Picnic itself put a moment on. A delivered state left behind by the above is not retold as groceries that arrived this morning
- The widget was redesigned around one layout that every state fills in: what this is about at the top, the one thing worth reading large at the bottom, the detail under it and what can be done about it below that. It has an icon and a colour per state, follows the dashboard into dark mode, and lays itself out for a half width tile on a phone as well as for a full width one
- The widget no longer opens anything when tapped, and the setting for it is gone: there is nothing on the other side of that tap
- A delivery drops off the widget four hours after it arrived, rather than six, and what it shows in the meantime is the moment Picnic says it arrived rather than the moment the app noticed
- A delivered order shows what came back in deposit once Picnic has counted it, and what went back: "6× Flessen, 1× Kratten"
- With nothing ordered, the widget says the cart is not ordered yet, and which delivery moment it is set to, or that none has been picked, which is worth knowing because an unpicked moment is not held for you. With one picked, the deadline to order by is the headline — "vóór 13:00", and "nog 25 min" over the last hour — with the amount and the slot under it and how much is missing to the slot's minimum below. A slot whose deadline passed is said to be too late rather than unpicked
- The widget takes after Picnic's own app: its van and basket icons, and each state as a badge in Picnic's colours. An order in hand is green, the green of its "Naar de winkel" button; a delivered one the darker green of its "Family" badge; a cart that still has to be ordered its red; something late the yellow of its "Actie" badge
- A placed order shows how many products are in it next to what it costs, "29 producten · € 53,43", and both stay current when something is added to the order afterwards. Products in the cart while the order can still be added to are said in so many words, "Nog 1 product in je mandje" and "11 minuten om bij te bestellen", with what they cost next to the delivery moment
- Every number on the widget has a caption saying what it is, beside it where the tile is wide enough and above it where it is not: "Bezorging over" over "20 uur", "Bestel vóór" over "13:00", "Bezorgd om" over "11:27"
- Amounts are written the way the language Homey is set to writes them, rather than the way the tablet showing the dashboard happens to be set up
- The widget never passes off what the app was last told as what is going on. When Picnic has not answered a poll in over a day it says there is no recent word from Picnic and when it last heard, instead of retelling an order from months ago as a delivery that is running late. An order the app only sees gone long after its window is not shown as just delivered either
- Picnic refusing to hand out an order until a 2FA code is verified (HTTP 403, `TWO_FACTOR_AUTHENTICATION_REQUIRED`) is now recognised as a sign-in being needed. The app used to log it as a failed poll every hour and carry on with what it knew from before, and the settings page called the login "NOT OK". Now Homey notifies you, the settings page asks for a sign-in and the widget says so
- The app needs Homey firmware v12.3.0 or newer from this release on. That is what the SDK documentation requires of an app containing a widget
- The widget previews, in the App Store and in the widget picker, now show the widget as it sits on a dashboard: its own frame, white in light mode and dark grey in dark mode, with the shadow Homey's preview template gives it, and inside it the Picnic-red badge with the van, the green status badge and the bar that fills. They were bare shapes on nothing, which read as loose lines on the picker's grey
- Picnic's mark sits at the top left of every tile, white on its red, the way Homey's own widgets carry the icon of what they are about. The state's icon moved into the badge next to its name, and stands on its own for a state that has no name: signed out, out of date, nothing planned. The badge is a tint of the state's colour under its ink rather than a filled block, so the one saturated thing on the tile is the mark
- Each colour on the widget means one thing: red is Picnic, and a cart still to order; the ochre of Picnic's yellow is a deadline within the hour; green is an order in hand or delivered. The notes about hurrying were red, which on the cart tile means something else
- A cart below the slot's minimum leads with the shortfall, "Tot het minimum nog € 12,14", since nothing can be ordered until it is made up, and the deadline moves under it. What the cart holds and costs sits at the top right in every state, where a placed order already showed it, and the cart is called "Te bestellen" rather than "Nog niet besteld": a thing to do, not a reproach
- A late delivery says how late: "12 minuten na het aangekondigde moment". A delivered one no longer says "Bezorgd" twice: the badge says it, the headline says when
- With nothing planned, and with a cart that has no slot, the widget says when something could be delivered: "Bezorgmomenten morgen: 3 van 12 vrij" and "Eerste om 08:30", counted from the two weeks of slots Picnic lists with the cart. A slot that closed unordered asks for a new one instead of only saying it is too late
- The names of the states are short enough to sit between the mark and the amount: "Wordt bezorgd" became "Komt eraan"
- `make gallery` shows every state of the widget in a browser, in both widths and both themes, without a Homey, and the states it shows are the ones the tests put through the widget. `make previews` redraws the App Store preview images, which now carry Picnic's mark
- A delivery is "Onderweg" only once the van is on the road, and the bar only fills from then. Picnic announces its twenty minute window the day before, and the widget took that for the van leaving: it said "Onderweg" with a bar for a delivery the next morning. Until the van leaves an order is a pending one, "Lopende bestelling" as Picnic calls it, counting down to its window without a bar; from three hours before the window, while a dashboard is looking, the app asks Picnic where the van is, and once the route is being driven the countdown is to Picnic's live window, which moves with the van. Where "Lopende bestelling" does not fit next to the amount it makes room by dropping the product count, and on a half width tile it is "Besteld"
- The bar under a delivery on its way is the van's whole trip, from the moment it left to the end of its window, and goes on filling through the window. It used to be full at the start of the window and start over from empty inside it, so a van that could be at the door any minute showed a bar a third of the way along
- Once a delivery has been paid for, the amount next to it is what was taken from the account: the order less what Picnic refunded for products that did not come and less the deposit that went back, "€ 51,89" rather than the "€ 53,43" that was ordered. Until Picnic has settled it, the deposit that went back is taken off as soon as it has been counted
- A returned can no longer reads "1× 1 x blikje": Picnic names a can by the price of one, and the widget already says how many
- The first free slot on the next delivery day is named by its window, "Eerste tussen 14:30–15:30", rather than by its start alone
- A delivery slot picked in Picnic's app while the basket is still empty is shown in place of the free slots, "Gekozen bezorgmoment: morgen 14:30–15:30" and "Bestel vóór 23:00", counted down over its last hour. With nothing ordered the widget now says "Geen lopende bestelling" rather than "Niets gepland", the counterpart of the "Lopende bestelling" an order in hand is called
- Nothing on a half width tile runs into its bottom edge any more. A tile has room for three lines under the headline, and a note of two left one for what was above it, which could take two: an order days out named its date and window ("za 20 sep 08:30–09:30"), in English "tomorrow" did the same, and a cart without a slot said what was free and which slot came first. Under a note an order now gives just its window, since the countdown above it already says which day that is, and the free slots say how many there are, the first of them giving way the way the amount in the cart already did. The note with nothing planned puts each of the two on a line of its own
- The widget catches up with Picnic's app within seconds rather than minutes. A cart filled or a slot picked in Picnic's app used to wait up to five minutes before the widget saw it, since that is how old the app let its copy of the cart get. Now the widget has Picnic asked when it opens, when it comes back into view and when it is tapped, with a buzz and the mark breathing until the answer is in. However many dashboards ask and however often someone taps, Picnic is asked at most once every half minute, and a widget out of view does not ask at all. A tablet that shows a dashboard all day still has the cart fetched every five minutes at most

## 3.7.0

- The app never asks Picnic for an SMS code by itself any more. A login that needs two-factor authentication leaves the app without a token until the code is entered, and the next poll saw that missing token, logged in again and had another code sent: every hour for as long as an order was open, and every minute during a delivery window. A code is now only ever sent because you saved your login on the app's settings page, which is the one moment you are waiting for one
- Homey notifies you when Picnic wants a code, once, instead of the app waiting in silence until someone happens to open its settings. Until you sign in there the app cannot follow your order, and it says so rather than sending text messages about it
- The settings page says a sign-in is needed when that is what Picnic is waiting for, and offers the field to enter a code whenever one has actually been sent, rather than only directly after a login was attempted on that page
- A code that has expired is no longer offered as though it would work. The settings page stops showing the field to type one in five minutes after it was sent, and asks for a sign-in instead, which is what has a new code sent
- A sign-in you cannot finish, because the phone is in another room or the code expired while you looked for it, has a way out: "Start over" on the settings page drops the half finished sign-in and puts you back to saving your login when you are ready
- A code Picnic rejects now says codes expire and what to do about it, instead of "Verification failed. Please try again." pointing you back at the code that just failed
- The "Resend code" button is gone. Logging in again is what sends a code, and one button for it is clearer than two
- The code in the newest SMS is now the one that works. Each of those repeated logins replaced the session the previous code belonged to, so a code that arrived a minute earlier was already being refused by the time it was typed in

## 3.6.2

- A failing poll no longer crashes the app with "an unexpected error occured" as the entire report. Whatever went wrong is written to the app log first, with the failure itself, its network or HTTP status code, where in the app it came from and the state the app was in, and the poll keeps running instead of taking the app down
- Anything that still escapes is logged the same way before the app goes down, so a crash report is no longer the only thing left to go on
- Picnic answering the order poll with a refusal or an unreadable answer says so, including the status code and what it answered, instead of surfacing later as a parse error that named nothing
- An order poll that Picnic never answers is given up on after the five seconds it was always meant to wait, instead of waiting forever
- The order poll no longer logs in with the wrong credentials when it has none stored: it read the position of the setting in a list rather than the setting itself

## 3.6.1

- The authentication status in the settings said NOT OK while the login was fine: the check was the last call still on Picnic's api/14, which Picnic no longer serves. It now asks the same api/15 Picnic is asked for everything else
- The status only says NOT OK when Picnic refuses the token with a 401 or a 403. A check that could not reach Picnic reports that instead of blaming the credentials, and a login waiting for its SMS code is reported as such
- The outcome of every check, including the status code Picnic answered with, is written to the app log
- A 2FA verification that Picnic confirms without handing back a new token no longer throws away the token from the login, which left the app with no session at all
- The app log now records what the app is doing without a debug build: the state it starts with, every login and 2FA step and how Picnic answered it, order status changes, which triggers fire and when, what got scheduled for a delivery window and what did not, and every change of the polling interval. No username, password or token is written to it
- A repeating failure is logged when it starts and once more when it clears, so a diagnostic report taken during a delivery window is not filled with the same line every minute
- A failed order request used to leave the poll hanging without a word. It now reports the failure
- A missing delivery window is reported as unknown instead of planning every job for 1 january 1970 and logging that each one already passed
- Adding a product no longer takes the app down when Picnic answers with something unexpected. Any answer that does not confirm the product is reported to the flow as a failure instead of throwing inside the response handler, where nothing caught it
- A failed add product request releases the cart lock it took, so a later add product action is not left waiting on a lock that never opens
- Every call to Picnic now carries the `x-picnic-agent` and `x-picnic-did` headers Picnic asked for in issue #17. Logging in and the order poll were sending one or neither, and the values now live in one place instead of being repeated per request

## 3.6.0

- Renamed the trigger "Groceries will be delivered soon" to "Delivery time has been announced", because it fires as soon as Picnic publishes the delivery window, usually hours before the delivery. Existing flows keep working, the card kept its id
- Added a new "Groceries will be delivered soon" trigger that fires a configurable number of minutes (30 by default) before the delivery window starts
- Delivery window updates after the announcement are now picked up, so the tokens and the window triggers follow Picnic instead of sticking to the first estimate
- The delivered soon warning and the raised poll rate stop once the groceries are delivered. The start and end of window triggers keep firing, they mark the window Picnic announced rather than the van, unless the delivery arrived before that window even started
- Moments that already passed are no longer silently dropped when the app restarts halfway through a delivery window
- Added tokens to the delivered, start of window and end of window triggers
- Eta timestamps are formatted in Homey's timezone

## 3.5.1

- Adding support for the 2FA authentication flow and fixing adding products

## 3.4.3

- Another bugfix adding products via action card due to changed JSON structure

## 3.4.2

- Bugfix adding products via action card

## 3.3.2

- Adding support for German customers of Picnic

## 3.2.7

- Bugfix triggers being reran on restart of the app

## 3.2.6

- Reduce default poll interval to prevent missing order trigger

## 3.2.5

- Bugfix adding product IDs as String upon API change

## 3.2.4

- Updated Homey community URL

## 3.2.3

- Fixed typo in global token

## 3.2.2

- Bugfix to prevent unnecessary firing of triggers after update

## 3.2.1

- Bugfix in start and end window trigger

## 3.2.0

- Adding order condition

## 3.1.0

- Adding global Picnic tokens

## 3.0.3

- Improve the app description

## 3.0.2

- Bugfix in order delivered trigger, removed trigger tokens

## 3.0.1

- Bugfix order announced end time

## 3.0.0

- Migrate to SDK3

## 2.3.3

- Adding request header

## 2.3.2

- Fixing uncaught exception

## 2.3.0

- Updated order summary API
- Removed speech input code, no longer supported by Homey
- Improved polling intervals based on order status

## 2.2.5

- Changing readme files to comply with Athom's standards

## 2.2.4

- Fixing bug that would expire your session after 2 weeks

## 2.2.3

- Adding order existence check

## 2.2.2

- Fixed order retrieval

## 2.2.1

- Fixed stupid typo in the Dutch translation

## 2.2.0

- Added triggers for the begin and end of the announced time frame of delivery

## 2.1.6

- Fixing another README formatting issue

## 2.1.5

- Fixing README formatting issue

## 2.1.4

- Updates to pass certification

## 2.1.3

- Updating dependencies and removing deprecated "request" dependency
- Removing obsolete "http" dependency

## 2.0.5

- Updating dependencies

## 2.0.4

- Bugfixes, adding re-authentication fix and improving error handling

## 2.0.3

- Adding brand color (thanks to Veldkornet)

## 2.0.2

- Bugfix: Adding improved exception handling to prevent crashes

## 2.0.1

- Bugfix: Homey v2.0 support

## 1.5.1

- Bugfix: fixing minor issues

## 1.5.0

- Feature: Adding recipy management

## 1.4.4

- Bugfix: Adding exception handler when no products are found
- Bugfix: Encoding products including non-ASCII characters

## 1.4.3

- Bugfix: Picnic uses a server-side lock when items are being added to your cart. This caused an issue when running a flow that adds multiple items to your cart at the same time. Fixing this bug in 1.4.3 by using a threat lock stored in the app's ManagerSettings.

## 1.4.2

- Bugfix: Checking if the order status response actually contains content that can be parsed.

## 1.4.1

- Bugfix: Catching any errors during periodic polling of the order status.

## 1.4.0
<b>Note that after this update you will have to re-authenticate via the Picnic app settings.</b>

- Bugfix: Fixing bug to store credentials to the settings

## 1.3.0
<b>Note that after this update you will have to re-authenticate via the Picnic app settings.</b>

- Bugfix: session expires after about a month. To solve this the app now stores the username and password and retrieves a new session as soon as it is required
