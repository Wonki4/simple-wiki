"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Props {
  href: string;
  // prefix면 하위 경로에서도 활성(스페이스), 아니면 정확히 일치할 때만 활성(페이지)
  prefix?: boolean;
  children: React.ReactNode;
}

export function NavLink({ href, prefix, children }: Props) {
  const pathname = usePathname();
  const active = prefix ? pathname === href || pathname.startsWith(href + "/") : pathname === href;
  return (
    <Link
      href={href}
      className={`lnb__item${active ? " lnb__item--active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      {children}
    </Link>
  );
}
