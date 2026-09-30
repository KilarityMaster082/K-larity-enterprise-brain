// Owner task: EB-100 Admin console shell — the frame of every operator screen: the "N / 54 · title · role · status" crumb,
// a four-cell brief row and the content with the handoff's fade-up entrance.
import { Metric, ScreenCrumb } from "@klarity/ui";
import type { ReactNode } from "react";

import { opCrumb } from "@/lib/screens";

export interface OpMetric {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone: "lime" | "sky" | "lavender" | "pink" | "green" | "cream";
}

export function OpScreen({ n, brief, children }: { n: number; brief?: OpMetric[]; children: ReactNode }) {
  return (
    <>
      <ScreenCrumb {...opCrumb(n)} />
      {brief ? (
        <div className="eb-brief" role="region" aria-label="Summary">
          {brief.slice(0, 4).map((m) => (
            <Metric key={m.label} {...m} />
          ))}
        </div>
      ) : null}
      <div className="eb-enter">{children}</div>
    </>
  );
}
