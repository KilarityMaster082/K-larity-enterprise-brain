// Owner task: EB-23 Web UI shell — an empty workspace dataset: a tenant that has not synced anything shows empty
// states, never another tenant's rows.
import type { WorkspaceDataset } from "./types";

export const EMPTY_WORKSPACE: WorkspaceDataset = {
  mail: [],
  knowledge: { chunks: 0, chunksDeltaMonth: 0, storageGb: 0, storageCapGb: 0, pipeline: [], sets: [] },
  folders: [],
  files: [],
  bases: [],
  graph: { nodes: [], edges: [] },
  meetings: [],
  todos: [],
  jobs: [],
  spaces: [],
  activity: [],
  apps: [],
  history: [],
  retention: { days: 1095, kmsKeyAlias: "", kmsKeyState: "active", lastRotatedAt: "2026-01-01T00:00:00+05:30" },
  agentTokenCap: 0,
  contents: {},
};
