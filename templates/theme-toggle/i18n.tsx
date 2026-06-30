"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const t = useTranslations("theme");
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Évite le mismatch SSR : tant que `mounted` est false, on rend un placeholder neutre.
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div
        aria-hidden
        className="inline-flex h-9 w-[7.5rem] rounded-full border border-border"
      />
    );
  }

  const options = [
    { value: "light", label: t("light"), Icon: Sun },
    { value: "system", label: t("system"), Icon: Monitor },
    { value: "dark", label: t("dark"), Icon: Moon },
  ] as const;

  return (
    <div
      role="radiogroup"
      aria-label={t("groupLabel")}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-background p-1"
    >
      {options.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            onClick={() => setTheme(value)}
            className={`inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full transition ${
              active
                ? "bg-foreground text-background"
                : "text-foreground/60 hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
