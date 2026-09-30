# Test Errors, Root Cause Analysis & Resolution Guide

**Owner task**: EB-17 CI, Governance & Testing Engineering  
**Scope**: Comprehensive catalog of test failures, runtime exceptions, module collisions, and governance gate errors across the Kilarity Enterprise Brain pipeline, detailing why each error occurred and the exact architectural fix implemented.  
**Last Updated**: October 2026

---

## 1. Executive Summary

During the development and testing of the Kilarity Enterprise Brain (spanning connectors, normalization, context engine, query understanding, and retrieval pipelines), various errors arose across five major categories:
1. **Module Name Collisions & Import Paths** (Python `sys.path` evaluation order).
2. **Asynchronous Test Runner Constraints** (`pytest-asyncio` vs standard event loops).
3. **Domain & AEC Linguistic Nuances** (British vs American spelling, Indian financial numbering, festival calendar calculations).
4. **Strict Repository Governance Gates** (`ops/ci/check_structure.py` whitelist violations, file ownership headers).
5. **Schema Validation & Fact Provenance** (SQL tool binding for figures, polarity contradiction detection, XML prompt injection boundaries).

This document serves as an exhaustive reference and post-mortem to prevent regression and ensure rapid diagnosis.

---

## 2. Comprehensive Error Catalog & Root Cause Analysis

### Error 1: Cross-Service Module Name Collision (`router.py`)
- **Affects**: `services/context-engine/tests/test_router.py`
- **Symptom**:
  ```text
  ImportError: cannot import name 'QueryRouter' from 'router'
  (/Users/.../services/llm-gateway/router.py)
  ```
- **Why It Happened**:
  Both `services/llm-gateway/router.py` (which defines `LlmRouter`) and `services/context-engine/router.py` (which defines `QueryRouter`) share the identical file name `router.py`. In the repository's `Makefile`, `PYTHONPATH_DEV` defines search paths in order:
  ```makefile
  PYTHONPATH_DEV = .:packages/connectors-sdk:...:services/llm-gateway:...:services/context-engine
  ```
  When `test_router.py` in `context-engine` called `from router import QueryRouter`, Python scanned `PYTHONPATH`, found `services/llm-gateway/router.py` first, cached it as the module `router` in `sys.modules`, and failed because `QueryRouter` only existed in `services/context-engine/router.py`.
- **The Fix**:
  In `services/context-engine/tests/test_router.py`, loaded the module dynamically using Python's `importlib.util` and registered it under a unique module namespace (`ce_router`) before class evaluation:
  ```python
  import importlib.util
  import sys
  from pathlib import Path

  _router_path = Path(__file__).resolve().parents[1] / "router.py"
  _spec = importlib.util.spec_from_file_location("ce_router", _router_path)
  ce_router = importlib.util.module_from_spec(_spec)
  sys.modules["ce_router"] = ce_router
  _spec.loader.exec_module(ce_router)

  QueryRouter = ce_router.QueryRouter
  RoutePath = ce_router.RoutePath
  ```

---

### Error 2: Missing Service Directory in Direct `pytest` Invocation
- **Affects**: Running individual test suites directly via CLI (`pytest services/context-engine/tests/...`)
- **Symptom**:
  ```text
  ModuleNotFoundError: No module named 'understand'
  # or No module named 'compress', No module named 'rerank'
  ```
- **Why It Happened**:
  The microservice directories (`services/context-engine`, `services/normalization`, `packages/storage`, etc.) are modular components that are not installed as global editable site-packages. The project's root `Makefile` explicitly constructs `PYTHONPATH_DEV` containing all package and service roots. When running `pytest <filepath>` directly from terminal without setting `PYTHONPATH`, pytest only adds the current working directory (`.`) to `sys.path`.
- **The Fix**:
  Always invoke test suites either via `make test` or by explicitly setting the path:
  ```bash
  # Option A: Full repo test suite (preserves all paths)
  make test

  # Option B: Single test file run
  PYTHONPATH=services/context-engine:packages/schemas python3 -m pytest services/context-engine/tests/test_understand.py
  ```

---

### Error 3: British vs American Spelling Mismatch in Intent Classifier
- **Affects**: `services/context-engine/understand.py`, `test_understand.py`
- **Symptom**:
  ```text
  FAILED: 'Who authorized the change from M30 to M35 grade concrete?' -> got lookup, expected decision_history
  assert 0.95 == 1.0
  ```
- **Why It Happened**:
  The regex classifier in `understand.py` for `IntentClass.DECISION_HISTORY` was originally hardcoded with Commonwealth/British English:
  ```python
  r"\bwho (?:approved|signed|authorised|ordered)\b"
  ```
  The test question contained the American spelling: `"Who authorized the change..."` (with a `z`). In Indian AEC corporate environments, both Commonwealth (`authorised`) and American (`authorized`) spellings are used interchangeably across contracts, WhatsApp messages, and emails. Because `authorized` did not match, the query fell back to the default `LOOKUP` intent.
- **The Fix**:
  Updated the regex to support both spellings using the character class `[sz]`:
  ```python
  # services/context-engine/understand.py:L180
  r"\bwho (?:approved|signed|authori[sz]ed|ordered)\b"
  ```

---

### Error 4: Root Directory Governance Gate Failure (`ops/ci/check_structure.py`)
- **Affects**: `make governance` / CI Structure Gate
- **Symptom**:
  ```text
  python3 ops/ci/check_structure.py
  error: Architecture & flow  diagram image.jpg: file not allowed at repo root
  structure check: 970 files, 1 error(s), 0 warning(s)
  make: *** [governance] Error 1
  ```
- **Why It Happened**:
  Per the architectural standards defined in `CLAUDE.md` and enforced by `ops/ci/check_structure.py` (EB-17, Risk R-7), the repository root only allows files explicitly enumerated in `ROOT_FILES` (e.g., `Makefile`, `README.md`, `package.json`, etc.). Untracked files, scratch images, or artifacts dropped directly into the repo root fail the gate because `check_structure.py` inspects both tracked and untracked files via `git ls-files --cached --others --exclude-standard`.
- **The Fix**:
  Relocated all diagrams, mockups, and visual assets into the designated `docs/architecture/` directory (where `LAYOUT["docs"] = None` permits documentation assets):
  ```bash
  mv "Architecture & flow  diagram image.jpg" docs/architecture/
  mv "architect daigram 2.jpg" docs/architecture/
  ```

---

### Error 5: Pytest Asyncio Coroutine Not Awaited
- **Affects**: Async tests in `context-engine/tests/`
- **Symptom**:
  ```text
  RuntimeWarning: coroutine 'test_hybrid_retrieval' was never awaited
  # or pytest skips test or fails to execute coroutines
  ```
- **Why It Happened**:
  The developer environment had pytest installed with `anyio-4.2.0`, but the standard `pytest-asyncio` plugin was not active or registered in the environment. Marking async test functions with `@pytest.mark.asyncio` resulted in pytest treating them as regular functions that returned an unawaited coroutine object rather than driving the event loop.
- **The Fix**:
  Standardized all async test functions across `context-engine/tests/` to use synchronous wrappers with explicit `asyncio.run()` invocations:
  ```python
  def test_batch_reranker_evaluation():
      async def _run():
          reranker = CrossEncoderReranker(backend=LiteLLMRerankerBackend())
          results = await reranker.rerank(query="Grade of concrete", candidates=[...], top_k=5)
          assert len(results) == 5

      asyncio.run(_run())
  ```

---

### Error 6: Contract Polarity Inversion & Contradiction Detection
- **Affects**: `services/context-engine/verify.py` (`EntailmentChecker`)
- **Symptom**:
  Contract audit failed to detect contradiction when comparing:
  - Source clause: *"Third-party water absorption test is required for all external masonry."*
  - Draft assertion: *"Third-party water absorption test is not required for masonry."*
  The verification passed as "supported" instead of flagging a conflict.
- **Why It Happened**:
  The original similarity checker calculated lexical and embedding overlap. Because 9 out of 10 words were identical ("Third-party", "water", "absorption", "test", "is", "for", "masonry"), the similarity score exceeded the 0.85 threshold. Generic stopwords filtering inadvertently stripped `"not"`, completely masking the semantic polarity inversion.
- **The Fix**:
  Added explicit polarity contradiction heuristics in `EntailmentChecker`:
  ```python
  NEGATION_MARKERS = {"not", "never", "no", "exempt", "waived", "neither", "excluded"}
  AFFIRMATIVE_MARKERS = {"required", "mandatory", "must", "shall", "obligatory", "compulsory"}

  # If one proposition contains a negation marker attached to a requirement
  # while the other is affirmative, force score = 0.0 and flag conflict:
  if self._has_polarity_conflict(claim_text, evidence_text):
      return EntailmentResult(is_supported=False, is_contradicted=True, score=0.0)
  ```

---

### Error 7: Indian Numeric & Currency Formatting Mismatch
- **Affects**: `services/context-engine/verify.py` (`NumberAndDateMatcher`)
- **Symptom**:
  Claims quoting `₹14,50,000` or `14.50 Lakhs` failed verification against BOQ source documents stating `1450000.00` or `INR 14,50,000/-`.
- **Why It Happened**:
  Indian financial and engineering documents use South Asian comma grouping (2,2,3 grouping: `14,50,000` instead of Western 3,3 grouping `1,450,000`) and vernacular denominations (`Lakh` for $10^5$, `Crore` for $10^7$). Direct string matching failed to reconcile representations of the identical quantity.
- **The Fix**:
  Implemented numeric normalization converting Indian currency notation and denominations into standard floating-point values before performing numerical equality checks with a 1% relative tolerance:
  ```python
  def normalize_indian_currency_number(val_str: str) -> float:
      s = val_str.replace("₹", "").replace("INR", "").replace("Rs.", "").replace("/-", "").strip()
      s = s.replace(",", "")
      multiplier = 1.0
      if re.search(r"\b(?:lakh|lakhs|lac|lacs)\b", s, re.IGNORECASE):
          multiplier = 1e5
          s = re.sub(r"\b(?:lakh|lakhs|lac|lacs)\b", "", s, flags=re.IGNORECASE).strip()
      elif re.search(r"\b(?:crore|crores|cr)\b", s, re.IGNORECASE):
          multiplier = 1e7
          s = re.sub(r"\b(?:crore|crores|cr)\b", "", s, flags=re.IGNORECASE).strip()
      return float(s) * multiplier
  ```

---

### Error 8: Figure Origin Integrity Failure in Answer Contracts
- **Affects**: `packages/schemas/answer_contract/schema.py`, `services/context-engine/reason.py`
- **Symptom**:
  ```text
  pydantic.ValidationError: 1 validation error for AnswerContract
  figures -> 0 -> origin
    Input should be 'sql' [type=literal_error, input_value='llm']
  ```
- **Why It Happened**:
  Under EB-47 (ADR D-29), to eliminate hallucinated financial figures in AEC projects (e.g. certified payments, retention sums, BOQ rates), all entries in `AnswerContract.figures` must strictly declare `origin="sql"`. When an LLM attempted to synthesize a numerical figure without calling the SQL calculation tool, the contract schema rejected the payload.
- **The Fix**:
  Updated `AnswerReasoner` to filter synthesized figures, require tool execution for quantitative outputs, and invoke a self-correction retry loop when schema validation errors occur:
  ```python
  # services/context-engine/reason.py
  if figure.get("origin") != "sql":
      # Move unverified numerical assertion to unknowns or execute SQL tool
      contract.unknowns.append(f"Figure {figure.get('label')} requires SQL certification.")
  ```

---

### Error 9: First-Line Ownership Header Missing in Python Files
- **Affects**: `ops/ci/check_structure.py`
- **Symptom**:
  ```text
  error: services/context-engine/understand.py: missing task header (e.g. # Owner task: EB-40 ...)
  ```
- **Why It Happened**:
  `ops/ci/check_structure.py` enforces code ownership traceability. Every code file under owned directories (`agents/`, `apps/`, `packages/`, `services/`) must start with an `# Owner task: EB-<id> ...` comment on line 1.
- **The Fix**:
  Ensured every created or modified file begins with its designated EB task identifier:
  ```python
  # Owner task: EB-40 Query understanding, intent classification and Indian temporal parsing
  ```

---

### Error 10: Notion API Property Schema Mismatch (`status` vs `select`)
- **Affects**: Project status sync via Notion MCP
- **Symptom**:
  ```json
  {"status": 400, "object": "error", "code": "validation_error", "message": "Status is expected to be select."}
  ```
- **Why It Happened**:
  The script attempted to update task status using Notion's default status payload:
  `{Status: {status: {name: "Done"}}}`. However, the Kilarity task database schema defined `Status` as a `select` property rather than a native Notion `status` property.
- **The Fix**:
  Updated the payload structure to match the database configuration:
  ```json
  { "Status": { "select": { "name": "Done" } } }
  ```

---

## 3. Summary Matrix of All Errors & Resolutions

| # | Error Name | Component / Task | Root Cause | Implemented Resolution |
|---|---|---|---|---|
| 1 | `cannot import name QueryRouter from router` | `services/context-engine` / EB-49 | Duplicate filename `router.py` resolved to `llm-gateway` first | Loaded via `importlib.util` under `ce_router` namespace |
| 2 | `ModuleNotFoundError: No module named 'understand'` | `services/context-engine` / EB-40 | Direct pytest run lacked root `PYTHONPATH_DEV` | Run via `make test` or export `PYTHONPATH=...` |
| 3 | Intent classification accuracy < 1.0 on golden set | `services/context-engine` / EB-40 | British `authorised` regex missed American `authorized` | Added `authori[sz]ed` character class regex |
| 4 | `file not allowed at repo root` | Governance / EB-17 | Images placed in repo root violated `ROOT_FILES` whitelist | Moved diagram assets to `docs/architecture/` |
| 5 | `coroutine was never awaited` | Test Suite / EB-43, EB-45 | `pytest-asyncio` plugin not registered in environment | Wrapped async tests in `def test_...` with `asyncio.run()` |
| 6 | Negation masking in contract entailment | `services/context-engine` / EB-48 | Stopwords removal stripped `"not"` before lexical match | Added dedicated polarity contradiction heuristic |
| 7 | Number mismatch on Indian currency formats | `services/context-engine` / EB-48 | Comma notation (`14,50,000`) and `Lakh`/`Cr` suffix | Added `normalize_indian_currency_number` float parser |
| 8 | `Input should be 'sql'` validation error | `packages/schemas` / EB-47 | LLM synthesized figure with `origin="llm"` | Enforced `origin="sql"` and schema retry loop |
| 9 | `missing task header` | Governance / EB-17 | Line 1 lacked `# Owner task: EB-<id>` | Added ownership comment to line 1 of every source file |
| 10 | `Status is expected to be select` | Notion MCP Tooling | Sent `{status: ...}` instead of `{select: ...}` | Converted payload to `{select: {name: "Done"}}` |

---

## 4. Engineering Prevention Rules

To prevent recurrence of these issues in ongoing tasks:
1. **Never create generic top-level file names that collide with existing packages** (`router.py`, `utils.py`, `config.py`). Use descriptive names (e.g. `query_router.py`).
2. **Always test using `make test` and `make governance`** before staging git commits.
3. **Always accommodate Commonwealth and American English spellings** (`authorise/authorize`, `analyse/analyze`, `centre/center`, `cheque/check`) in Indian AEC systems.
4. **Never drop non-whitelisted files in the repository root**. Put diagrams in `docs/architecture/` and test fixtures in `tests/fixtures/`.
5. **Always enforce line 1 task ownership headers** across all `.py`, `.ts`, and `.sh` files.
