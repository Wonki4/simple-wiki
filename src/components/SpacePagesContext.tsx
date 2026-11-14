"use client";

import { createContext, type ReactNode } from "react";
import type { LinkPage } from "@/lib/wiki-link-completion";

export const SpacePagesContext = createContext<readonly LinkPage[]>([]);

export function SpacePagesProvider({ pages, children }: { pages: LinkPage[]; children: ReactNode }) {
  return <SpacePagesContext.Provider value={pages}>{children}</SpacePagesContext.Provider>;
}
