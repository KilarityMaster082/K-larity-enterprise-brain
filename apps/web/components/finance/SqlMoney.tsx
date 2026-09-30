// Owner task: EB-55 Financial Brain page — renders a rupee figure only if it carries a valid SQL origin for this tenant
// (CLAUDE.md rule 3). Indian lakh/crore notation; the exact value and the view.column that produced it are in the tooltip.
import { formatINR, formatINRCompact, formatINRShort } from "@klarity/ui/format";

import { assertSqlFigure, assertTenant, originLabel, type SqlFigure } from "@/lib/finance-sql";

export function SqlMoney({ figure, tenantId, style = "short", className }: { figure: SqlFigure; tenantId: string; style?: "short" | "compact" | "exact"; className?: string }) {
  assertSqlFigure(figure);
  assertTenant(figure, tenantId);
  const text = style === "exact" ? formatINR(figure.amount) : style === "compact" ? formatINRCompact(figure.amount) : formatINRShort(figure.amount);
  return (
    <span className={`eb-num${figure.amount < 0 ? " eb-danger" : ""}${className ? ` ${className}` : ""}`} title={`${formatINR(figure.amount)} · ${originLabel(figure)}${figure.asOf ? ` · as of ${figure.asOf}` : ""}`} data-origin={originLabel(figure)}>
      {text}
    </span>
  );
}
