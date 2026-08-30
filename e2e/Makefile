# End-to-end tests (Robot Framework + Browser/Playwright).
#
# One-time setup:
#   make install
#
# Run against the default target from config/config.yaml (http://localhost):
#   make test
#
# Run somewhere else, or with other credentials:
#   make test ARGS="-v BASE_URL:https://staging.example"
#   make test ARGS="-V config/config.local.yaml"
#
# Run a subset by tag:
#   make smoke
#   make test ARGS="--include navigation"

VENV    ?= .venv
PYTHON  ?= python3
ROBOT   := $(VENV)/bin/robot
RESULTS ?= results
ARGS    ?=

.PHONY: help
help:
	@echo "Available targets:"
	@echo "  install   Create the virtualenv and download the browsers"
	@echo "  test      Run every suite in tests/"
	@echo "  smoke     Run only the tests tagged 'smoke'"
	@echo "  overview  Run only the overview suites"
	@echo "  dryrun    Parse the suites without opening a browser"
	@echo "  clean     Remove results/"

.PHONY: install
install:
	$(PYTHON) -m venv $(VENV)
	$(VENV)/bin/pip install --upgrade pip
	$(VENV)/bin/pip install -r requirements.txt
	$(VENV)/bin/rfbrowser init

.PHONY: test
test:
	$(ROBOT) --outputdir $(RESULTS) $(ARGS) tests

.PHONY: smoke
smoke:
	$(ROBOT) --outputdir $(RESULTS) --include smoke $(ARGS) tests

.PHONY: overview
overview:
	$(ROBOT) --outputdir $(RESULTS) $(ARGS) tests/overview

# Checks that every keyword a suite uses actually resolves. No browser, no target
# environment — useful in CI and after renaming a keyword.
.PHONY: dryrun
dryrun:
	$(ROBOT) --dryrun --outputdir $(RESULTS) $(ARGS) tests

.PHONY: clean
clean:
	rm -rf $(RESULTS)
