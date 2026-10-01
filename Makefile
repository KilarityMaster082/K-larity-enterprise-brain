# Owner task: EB-16 Repo scaffold with docs pack, CLAUDE.md and AGENTS.md
UPSTREAM ?= ../.upstream
PYTHON ?= python3
PYTHONPATH_DEV = .:packages/connectors-sdk:packages/tenant-context:packages/storage:services/ingestion:services/control-plane:packages/ontology:packages/permissions:apps/api:services/llm-gateway:services/normalization:services/context-engine:services/evaluation/leakage:services/evaluation/security:services/entity-resolution:services/knowledge-graph:services/memory:services/signals

.PHONY: governance borrow-map vendor test dev-env dev-up dev-down dev-reset dev-logs

governance:  ## layout, ownership, licence boundaries, vendored-code integrity, tenant scope, borrow map freshness
	python3 ops/ci/check_structure.py
	python3 ops/ci/check_tenant_scope.py
	python3 ops/ci/borrow_map.py --check
	python3 ops/ci/check_compose.py

borrow-map:  ## regenerate docs/borrow/BORROW_MAP.md from docs/borrow/borrow-register.json
	python3 ops/ci/borrow_map.py

vendor:  ## re-vendor approved upstream features from pinned clones in $(UPSTREAM)
	python3 ops/ci/vendor_upstream.py $(UPSTREAM)
	python3 ops/ci/borrow_map.py

test:  ## unit tests (needs pytest + cryptography; see .github/workflows/ci.yml for pinned versions)
	PYTHONPATH=$(PYTHONPATH_DEV) $(PYTHON) -m pytest -q -p no:cacheprovider --import-mode=importlib packages/connectors-sdk/tests packages/schemas/tests services/ingestion/connectors/file_drop/tests \
		packages/tenant-context/tests packages/storage/tests services/control-plane/tests packages/ontology/tests packages/permissions/tests packages/approvals/tests apps/api/tests services/llm-gateway/tests services/ingestion/workflows/tests services/normalization/tests services/ingestion/connectors/gmail/tests services/ingestion/connectors/whatsapp_export/tests services/context-engine/tests services/evaluation/leakage/tests services/evaluation/security/tests services/entity-resolution/tests services/knowledge-graph/tests services/memory/tests services/signals/tests ops/ci/tests

.PHONY: test-web
test-web:  ## web apps: unit tests (no dependencies beyond Node 24), typecheck, production builds, client-bundle leak check
	pnpm -r --if-present test
	pnpm -r --if-present typecheck
	pnpm -r build
	python3 ops/ci/check_client_bundle.py

COMPOSE_DEV = docker compose --env-file deploy/.env.dev -f deploy/docker-compose.yml

dev-env:  ## generate deploy/.env.dev with random local secrets (kept if it already exists)
	python3 ops/dev/gen_env.py

dev-up: dev-env  ## start the local stack and wait until every service is healthy
	$(COMPOSE_DEV) up -d --wait

dev-down:  ## stop the stack, keep data
	$(COMPOSE_DEV) down

dev-reset:  ## stop the stack and DELETE all local data volumes
	$(COMPOSE_DEV) down -v

dev-logs:  ## follow logs
	$(COMPOSE_DEV) logs -f --tail=100
