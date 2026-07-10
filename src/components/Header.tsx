import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";

export async function Header() {
  const session = await auth();
  return (
    <header className="masthead">
      <div className="masthead__inner">
        <Link href="/" className="brand" aria-label="simple-wiki 홈">
          <span className="brand__bracket">[[</span>
          simple-wiki
          <span className="brand__bracket">]]</span>
        </Link>
        <form action="/search" method="GET" className="search">
          <input type="search" name="q" placeholder="검색" className="search__field" />
        </form>
        {session?.user ? (
          <div className="userbar">
            <span className="userbar__name">{session.user.name}</span>
            <Link href="/settings/tokens" className="userbar__link">
              토큰
            </Link>
            <form
              action={async () => {
                "use server";
                await signOut();
              }}
            >
              <button className="userbar__link">로그아웃</button>
            </form>
          </div>
        ) : (
          <form
            action={async () => {
              "use server";
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
