# Connector SDK

> Owner task: EB-28 Connector SDK and source registry

One interface for every source. A connector implements five methods; `run_sync` does the rest.

| Method | Job |
|---|---|
| `authenticate(ctx, credentials)` | Validate credentials handed in (decrypted) by the control plane. Never store them. |
| `list_items(ctx)` | Every `external_id` currently at the source — used to detect deletions. |
| `fetch_since(ctx, cursor)` | Yield `RawItem`s / `SyncFailure`s for one batch, in cursor order; **return** the next `Cursor` (`has_more=True` if another batch waits). |
| `fetch_acl(ctx, item)` | Who may see the item at the source. |
| `normalize(ctx, item, acl, raw_ref)` | Map to `NormalizedRecord`s via `self.make_record(...)`. |

`run_sync` then, per item: skips it if its SHA-256 matches the stored hash → writes the raw bytes to
the tenant's raw store → fetches the ACL → normalises → checks every record is for this tenant/source →
writes to the sink → records the hash. The cursor is saved after every batch, so a killed worker
resumes from the last completed batch. Sinks must upsert on `(tenant_id, record_id)`.

Register the class with `@register` and set `connector_type`. Reference implementation:
`services/ingestion/connectors/file_drop/connector.py`.

Run tests: `make test`.
