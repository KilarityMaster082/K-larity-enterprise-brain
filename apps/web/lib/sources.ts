// Owner task: EB-50 Ask Brain UI — display metadata for evidence source types (usable on server and client).
import type { IconName } from "@klarity/ui";

import type { SourceType } from "./contracts";

export const SOURCE_META: Record<SourceType, { icon: IconName; label: string }> = {
  email: { icon: "mail", label: "Email" },
  whatsapp: { icon: "chat", label: "WhatsApp" },
  sheet: { icon: "sheet", label: "Sheet" },
  document: { icon: "documents", label: "Document" },
  drawing: { icon: "drawing", label: "Drawing" },
  meeting: { icon: "chat", label: "Meeting" },
  ledger: { icon: "database", label: "Ledger query" },
};
