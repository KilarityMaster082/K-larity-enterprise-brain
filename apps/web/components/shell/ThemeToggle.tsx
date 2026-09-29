"use client";
// Owner task: EB-23 Web UI shell — light/dark toggle; follows the OS until the user picks.
import { useEffect, useState } from "react";

import { Icon } from "@klarity/ui";

import { THEME_COOKIE, parseTheme, type ThemePref } from "@/lib/theme";

type Theme = ThemePref;

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(parseTheme(document.documentElement.dataset.theme) ?? systemTheme());
  }, []);

  function toggle() {
    const next: Theme = (theme ?? systemTheme()) === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    setTheme(next);
  }

  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button type="button" className="btn btn-ghost btn-icon" onClick={toggle} aria-label={label} title={label}>
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}

