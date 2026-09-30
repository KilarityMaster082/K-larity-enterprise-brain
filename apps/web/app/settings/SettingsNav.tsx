"use client";
// Owner task: EB-93 Settings: connected sources and members — sub-navigation pills with the current tab marked.
import { PillLink } from "@klarity/ui";
import { usePathname } from "next/navigation";

export function SettingsNav({ tabs, workspace }: { tabs: { href: string; label: string }[]; workspace: string }) {
  const path = usePathname();
  return (
    <nav className="eb-row" aria-label={`Settings for ${workspace}`}>
      {tabs.map((t) => (
        <PillLink key={t.href} href={t.href} active={path === t.href || path.startsWith(`${t.href}/`)} aria-current={path === t.href ? "page" : undefined}>
          {t.label}
        </PillLink>
      ))}
    </nav>
  );
}
