# Owner task: EB-16 Repo scaffold with docs pack, CLAUDE.md and AGENTS.md
UPSTREAM ?= ../.upstream
PYTHON ?= python3
PYTHONPATH_DEV = packages/connectors-sdk:packages/tenant-context:packages/storage:services/ingestion:services/control-plane:packages/ontology:packages/permissions:apps/api:services/llm-gateway

.PHONY: governance borrow-map vendor test

governance:  ## layout, ownership, licence boundaries, vendored-code integrity, tenant scope, borrow map freshness
	python3 ops/ci/check_structure.py
	python3 ops/ci/check_tenant_scope.py
	python3 ops/ci/borrow_map.py --check

borrow-map:  ## regenerate docs/borrow/BORROW_MAP.md from docs/borrow/borrow-register.json
	python3 ops/ci/borrow_map.py

vendor:  ## re-vendor approved upstream features from pinned clones in $(UPSTREAM)
	python3 ops/ci/vendor_upstream.py $(UPSTREAM)
	python3 ops/ci/borrow_map.py

test:  ## unit tests (needs pytest + cryptography; see .github/workflows/ci.yml for pinned versions)
	PYTHONPATH=$(PYTHONPATH_DEV) $(PYTHON) -m pytest -q -p no:cacheprovider packages/connectors-sdk/tests services/ingestion/connectors/file_drop/tests \
		packages/tenant-context/tests packages/storage/tests services/control-plane/tests packages/ontology/tests packages/permissions/tests apps/api/tests services/llm-gateway/tests
