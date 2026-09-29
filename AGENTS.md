# AI Coding Agent Instructions

Read CLAUDE.md, SECURITY.md and DECISIONS.md before modifying code.

When implementing a Notion task, use its exact `Repo path` as the primary destination. If a task spans multiple paths, keep orchestration in the service named by the task and put shared contracts in `packages/`.

Never put business logic in UI components, connector-specific logic in the context engine, or tenant-specific logic in core services.

For every implementation: add tests beside the relevant service/package, update schemas/contracts first when interfaces change, preserve tenant isolation, and include evidence/telemetry required by the task acceptance criteria.
