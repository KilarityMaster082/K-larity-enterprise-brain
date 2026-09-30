// Owner task: EB-103 Communications hub — Communications & Email Feed (screen 5): every project email (Gmail/Outlook) and
// chat thread in one inbox, filtered by folder, project or category (Tender, RFI, Change Order, Invoices) with keyword
// search. Threads that quote money are hidden from roles without finance.view.
import { Bento, Dot, Grid, Pill } from "@klarity/ui";
import type { Metadata } from "next";
import Link from "next/link";

import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { commsBrief } from "@/lib/briefs";
import type { MailCategory } from "@/lib/data/types";
import { pageContext } from "@/lib/page";
import { initialsOf, mailFolders, projectName, searchThreads, shortWhen, toneFor, visibleMail } from "@/lib/workspace";

export const metadata: Metadata = { title: "Communications" };

const CATEGORIES: MailCategory[] = ["Tender", "RFI", "Change Order", "Invoices"];

export default async function CommunicationsPage({ searchParams }: { searchParams: Promise<{ folder?: string; project?: string; category?: string; q?: string }> }) {
  const ctx = await pageContext("/communications", "comms.view");
  if (!ctx.allowed) return <NoAccess what="communications" />;
  const sp = await searchParams;
  const { view, session } = ctx;
  const all = visibleMail(view, ctx.can);
  const counts = mailFolders(all);
  const folder = sp.folder === "starred" || sp.folder === "sent" ? sp.folder : "inbox";
  const category = CATEGORIES.find((c) => c === sp.category);
  const project = view.data.projects.find((p) => p.projectId === sp.project)?.projectId;
  const q = (sp.q ?? "").slice(0, 120);

  let list = all.filter((t) => (folder === "starred" ? t.starred : t.folder === folder));
  if (project) list = list.filter((t) => t.projectId === project);
  if (category) list = list.filter((t) => t.category === category);
  list = searchThreads(list, q);

  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { folder: folder === "inbox" ? undefined : folder, project, category, q: q || undefined, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/communications?${s}` : "/communications";
  };

  return (
    <Screen n={5} brief={<Brief metrics={commsBrief(view, ctx.can)} live={presenceOf(view.members, session.user)} />}>
      <Grid cols="190px 1fr" align="start">
        <Bento tone="black" aria-label="Folders" className="eb-stack tight">
          <h2 className="eb-eyebrow" style={{ color: "#999" }}>Folders</h2>
          <Link className="eb-folder" href={href({ folder: undefined })} aria-current={folder === "inbox" ? "page" : undefined}>
            Inbox <span className="eb-auto">{counts.unread || counts.inbox}</span>
          </Link>
          <Link className="eb-folder" href={href({ folder: "starred" })} aria-current={folder === "starred" ? "page" : undefined}>Starred <span className="eb-auto">{counts.starred || ""}</span></Link>
          <Link className="eb-folder" href={href({ folder: "sent" })} aria-current={folder === "sent" ? "page" : undefined}>Sent <span className="eb-auto">{counts.sent || ""}</span></Link>
          <h2 className="eb-eyebrow" style={{ color: "#999", marginTop: 12 }}>Project tags</h2>
          {view.data.projects.map((p) => (
            <Link key={p.projectId} className="eb-folder" href={href({ project: project === p.projectId ? undefined : p.projectId })} aria-current={project === p.projectId ? "page" : undefined}>
              <span className="eb-dot-static" style={{ background: `var(--eb-${toneFor(p.projectId)})` }} aria-hidden="true" />
              {p.name.replace(/^Project /, "")}
            </Link>
          ))}
        </Bento>

        <Bento tone="strong" aria-label="Messages">
          <div className="eb-row" style={{ marginBottom: 10 }}>
            <Link className="eb-pill" data-active={!category || undefined} href={href({ category: undefined })}>All</Link>
            {CATEGORIES.map((c) => (
              <Link key={c} className="eb-pill" data-active={category === c || undefined} href={href({ category: category === c ? undefined : c })}>
                {c}
              </Link>
            ))}
            <form className="eb-search eb-auto" role="search" action="/communications" style={{ width: 240 }}>
              {folder !== "inbox" ? <input type="hidden" name="folder" value={folder} /> : null}
              {project ? <input type="hidden" name="project" value={project} /> : null}
              {category ? <input type="hidden" name="category" value={category} /> : null}
              <label className="visually-hidden" htmlFor="mail-q">Search mail and chat</label>
              <input id="mail-q" name="q" type="search" placeholder="Search mail and chat…" defaultValue={q} />
            </form>
          </div>
          {list.length ? (
            <ul className="eb-list">
              {list.map((t) => (
                <li key={t.threadId}>
                  <Link className="eb-li" href={`/communications/${t.threadId}`} style={{ padding: "10px 6px" }}>
                    <span className="eb-avatar" style={{ background: `var(--eb-${toneFor(t.projectId ?? t.fromOrg)})`, width: 30, height: 30 }} aria-hidden="true">
                      {initialsOf(t.fromOrg === "Studio 8 Hats" ? t.fromName : t.fromOrg)}
                    </span>
                    <div className="eb-grow">
                      <div className="eb-li-title" style={{ fontWeight: t.unread ? 700 : 600 }}>
                        {t.unread ? <Dot ink label="Unread" /> : null} {t.fromOrg === "Studio 8 Hats" ? t.fromName : t.fromOrg}
                        {t.starred ? <span aria-label="Starred"> ★</span> : null}
                      </div>
                      <div className="eb-li-sub eb-trunc">{t.subject}</div>
                    </div>
                    <Pill tone="outline" size="sm">{t.category}</Pill>
                    <span className="eb-li-sub" style={{ width: 54, textAlign: "right", flex: "none" }}>{shortWhen(t.lastAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="eb-body" role="status">
              {all.length ? `No ${folder === "inbox" ? "messages" : folder} match${q ? ` “${q}”` : ""}.` : "No messages yet. Email and chat threads appear here once a mailbox or WhatsApp export is connected."}
              {projectName(view, project) && project ? ` Filter: ${projectName(view, project)}.` : ""}
            </p>
          )}
        </Bento>
      </Grid>
    </Screen>
  );
}
