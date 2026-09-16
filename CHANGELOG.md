# Changelog

All notable changes to the Picnic app for Homey, newest first. The short version of
each release is what Homey shows in the app store, and lives in `.homeychangelog.json`.

## Unreleased

- The app never asks Picnic for an SMS code by itself any more. A login that needs two-factor authentication leaves the app without a token until the code is entered, and the next poll saw that missing token, logged in again and had another code sent: every hour for as long as an order was open, and every minute during a delivery window. A code is now only ever sent because you saved your login on the app's settings page, which is the one moment you are waiting for one
- Homey notifies you when Picnic wants a code, once, instead of the app waiting in silence until someone happens to open its settings. Until you sign in there the app cannot follow your order, and it says so rather than sending text messages about it
- The settings page says a sign-in is needed when that is what Picnic is waiting for, and offers the field to enter a code whenever one has actually been sent, rather than only directly after a login was attempted on that page
- A code that has expired is no longer offered as though it would work. The settings page stops showing the field to type one in five minutes after it was sent, and asks for a sign-in instead, which is what has a new code sent
- A sign-in you cannot finish, because the phone is in another room or the code expired while you looked for it, has a way out: "Start over" on the settings page drops the half finished sign-in and puts you back to saving your login when you are ready
- A code Picnic rejects now says codes expire and what to do about it, instead of "Verification failed. Please try again." pointing you back at the code that just failed. The same for a resend Picnic refuses, which means the sign-in behind it has lapsed and only a new one will do
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
