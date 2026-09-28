# The short way in: `make run` starts the app on your Homey and sorts out
# whatever it needs first. `make` on its own says what else is here.
#
# Every target that hands the app to the Homey CLI depends on node_modules,
# because the CLI checks the dependency tree before it builds and refuses
# without it, in terms of npm rather than of what is missing. Which version of
# that question to ask is exactly what make is for: the rule at the bottom runs
# npm install when package.json has moved on since the last one, and otherwise
# gets out of the way.

NPM ?= npm
HOMEY ?= homey

.DEFAULT_GOAL := help
.PHONY: help run run-clean install test lint validate compose validate-cli gallery previews homey-cli

help: ## Say what is here
	@echo "make <target>"
	@echo
	@grep -E '^[a-z][a-z-]*:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN { FS = ":.*## " }; { printf "  %-12s %s\n", $$1, $$2 }'

run: node_modules homey-cli ## Run the app on your Homey, until you stop it
	$(HOMEY) app run

run-clean: node_modules homey-cli ## Run it after deleting the stored data, which costs you your Picnic login
	$(HOMEY) app run --clean

install: node_modules homey-cli ## Install the app on your Homey, where it stays
	$(HOMEY) app install

test: node_modules ## Run the tests
	node --test

lint: node_modules ## Check every file against .editorconfig
	npx editorconfig-checker

validate: node_modules ## Check the app the way the App Store does, without a Homey
	node scripts/validate.js

compose: node_modules homey-cli ## Regenerate app.json from .homeycompose and the widgets
	$(HOMEY) app compose

validate-cli: node_modules homey-cli ## The same validation, through the Homey CLI
	$(HOMEY) app validate --level publish

gallery: ## Show every state of the dashboard widget in a browser, without a Homey
	node scripts/widget-gallery.js

previews: ## Redraw the widget's preview images for the App Store
	node scripts/previews.js

# The dependencies, installed only when package.json is newer than the last
# install. npm does not always leave a mark make can read, so one is left here.
node_modules: package.json
	$(NPM) install
	@touch $@

homey-cli:
	@command -v $(HOMEY) > /dev/null || { \
		echo "The Homey CLI is not installed. Install it with: npm install -g $(HOMEY)"; \
		exit 1; \
	}
