// Owner task: EB-23 Web UI shell — header + designed empty state for pages whose data is not wired yet.
import { Icon } from "./Icon";

interface Props {
  title: string;
  lead: string;
  icon: string;
  emptyTitle: string;
  emptyBody: string;
  willShow: string[];
  tiles?: number;
}

export function PagePlaceholder({ title, lead, icon, emptyTitle, emptyBody, willShow, tiles = 3 }: Props) {
  return (
    <div className="content content-wide">
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          <p>{lead}</p>
        </div>
      </header>
      <section className="card empty" aria-labelledby="empty-title">
        <span className="empty-icon">
          <Icon name={icon} size={22} />
        </span>
        <h2 id="empty-title">{emptyTitle}</h2>
        <p>{emptyBody}</p>
        <div>
          <p style={{ fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>What you&apos;ll see here</p>
          <ul>
            {willShow.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      </section>
      <div className="preview-grid" aria-hidden="true">
        {Array.from({ length: tiles }, (_, i) => (
          <div key={i} className="card" style={{ padding: 16, display: "grid", gap: 10 }}>
            <div className="skeleton" style={{ height: 12, width: "40%" }} />
            <div className="skeleton" style={{ height: 22, width: "70%" }} />
            <div className="skeleton" style={{ height: 10, width: "90%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function NoAccess({ what }: { what: string }) {
  return (
    <div className="content">
      <section className="card empty" role="alert">
        <span className="empty-icon">
          <Icon name="lock" size={22} />
        </span>
        <h2>You don&apos;t have access to {what}</h2>
        <p>Ask a workspace owner if you need it. Access follows your role and the permissions of each source.</p>
      </section>
    </div>
  );
}
