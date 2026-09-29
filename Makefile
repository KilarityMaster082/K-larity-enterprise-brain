# Owner task: EB-16 Repo scaffold with docs pack, CLAUDE.md and AGENTS.md
UPSTREAM ?= ../.upstream
PYTHON ?= python3
PYTHONPATH_DEV = packages/connectors-sdk:services/ingestion

.PHONY: governance borrow-map vendor test

governance:  ## layout, ownership, licence boundaries, vendored-code integrity, borrow map freshness
	python3 ops/ci/check_structure.py
	python3 ops/ci/borrow_map.py --check

borrow-map:  ## regenerate docs/borrow/BORROW_MAP.md from docs/borrow/borrow-register.json
	python3 ops/ci/borrow_map.py

vendor:  ## re-vendor approved upstream features from pinned clones in $(UPSTREAM)
	python3 ops/ci/vendor_upstream.py $(UPSTREAM)
	python3 ops/ci/borrow_map.py

test:  ## unit tests (stdlib + pytest only)
	PYTHONPATH=$(PYTHONPATH_DEV) $(PYTHON) -m pytest -q -p no:cacheprovider packages/connectors-sdk/tests services/ingestion/connectors/file_drop/tests
