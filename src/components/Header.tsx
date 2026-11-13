import { Disclosure } from "./Disclosure";
import { WikiIcon } from "./WikiIcon";
import Link from "next/link";
import { cookies } from "next/headers";
import { auth, signIn, signOut } from "@/auth";
import { SearchBox } from "@/components/SearchBox";

export async function Header() {
  const session = await auth();
  return (
    <header className="masthead">
      <div className="masthead__inner">
        <button type="button" className="nav-trigger icon-button" popoverTarget="wiki-navigation" aria-label="위키 탐색 열기"><WikiIcon name="menu" /></button>
        <Link href="/" className="brand" aria-label="simple wiki 홈">
          <span className="brand__badge"><WikiIcon name="book" /></span>
          <span className="brand__word">
            <span className="brand__word-1">simple</span>
            <span className="brand__word-2">wiki</span>
          </span>
        </Link>
        <SearchBox />
        {session?.user ? (
          <Disclosure label="계정 메뉴" trigger={<WikiIcon name="account" />} className="account-menu">
            <Link href="/me" className="userbar__name" title="마이페이지">
              {session.user.name}
            </Link>
            {session.isWikiAdmin && (
              <Link href="/groups" className="userbar__link">
                그룹
              </Link>
            )}
            <Link href="/settings/tokens" className="userbar__link">
              토큰
            </Link>
            <form
              action={async () => {
                "use server";
                // 명시적 로그아웃 뒤에는 Keycloak SSO 세션이 남아 있어도 자동 재로그인을 막는다.
                (await cookies()).set("swk_manual_logout", "1", {
                  httpOnly: true,
                  sameSite: "lax",
                  secure: process.env.NODE_ENV === "production",
                  path: "/",
                });
                await signOut({ redirectTo: "/" });
              }}
            >
              <button className="userbar__link">로그아웃</button>
            </form>
          </Disclosure>
        ) : (
          <form
            action={async () => {
              "use server";
              (await cookies()).delete("swk_manual_logout");
              await signIn("keycloak");
            }}
          >
            <button className="userbar__link">로그인</button>
          </form>
        )}
      </div>
    </header>
  );
}
