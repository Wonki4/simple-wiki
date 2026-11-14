"use client";

import { createContext, type ReactNode } from "react";
import type { LinkPage } from "@/lib/wiki-link-completion";

export const SpacePagesContext = createContext<{ pages: LinkPage[]; spaces: { key: string; name: string }[] }>({ pages: [], spaces: [] });

export function SpacePagesProvider({ pages, spaces, children }: { pages: LinkPage[]; spaces: { key: string; name: string }[]; children: ReactNode }) {
  return <SpacePagesContext.Provider value={{ pages, spaces }}>{children}</SpacePagesContext.Provider>;
}
