"use client";

import { useEffect, useState } from "react";
import type { CmsMarketingLocale } from "@/lib/cms2/marketing-locales";
import type { CmsPublicUi } from "@/lib/cms2/public-ui";
import { tx } from "@/lib/cms2/public-ui";
import type { CmsTheme } from "@/lib/cms2/types";
import type { PublicBookableSpaceApiRow } from "@/lib/spaces/public-spaces-shared";
import { groupPublicSpacesByProperty } from "@/lib/spaces/public-browse";
import { Cms2PropertyCards } from "./Cms2PropertyCards";

type Props = {
  theme: CmsTheme;
  basePath: string;
  locale: CmsMarketingLocale;
  ui: CmsPublicUi;
  /** Homepage: max 4 cards + “view all”. Spaces index: full grid + title. */
  variant: "home" | "spaces";
};

export function Cms2PublicSpacesFetchClient({ theme, basePath, locale, ui, variant }: Props) {
  const [spaces, setSpaces] = useState<PublicBookableSpaceApiRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/spaces/public")
      .then((r) => r.json())
      .then((data: unknown) => {
        if (cancelled) return;
        setSpaces(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch spaces:", err);
        if (!cancelled) {
          setSpaces([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <p style={{ color: theme.muted, margin: 0 }}>{tx(ui, "home.spacesLoading")}</p>
    );
  }

  const list = spaces ?? [];
  const groups = groupPublicSpacesByProperty(list);

  if (variant === "home") {
    if (groups.length === 0) {
      return <p style={{ color: theme.muted }}>{tx(ui, "home.noSpaces")}</p>;
    }
    return (
      <Cms2PropertyCards
        theme={theme}
        basePath={basePath}
        ui={ui}
        locale={locale}
        groups={groups}
        maxProperties={4}
        showViewAllLink={groups.length > 4}
      />
    );
  }

  if (groups.length === 0) {
    return <p style={{ color: theme.muted }}>{tx(ui, "spaces.noSpaces")}</p>;
  }

  return (
    <>
      <h1 style={{ margin: "0 0 8px", fontSize: "1.75rem", color: theme.petrolDark }}>{tx(ui, "spaces.title")}</h1>
      <p style={{ margin: "0 0 28px", color: theme.muted }}>{tx(ui, "spaces.browseByProperty")}</p>
      <Cms2PropertyCards theme={theme} basePath={basePath} ui={ui} locale={locale} groups={groups} />
    </>
  );
}
