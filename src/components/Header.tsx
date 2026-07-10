import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";
import { SearchBox } from "@/components/SearchBox";

export async function Header() {
  const session = await auth();
  return (
    <header className="masthead">
      <div className="masthead__inner">
        <Link href="/" className="brand" aria-label="simple wiki 홈">
          <svg className="brand__badge" viewBox="0 0 24 24" aria-hidden="true">
            <rect width="24" height="24" rx="6" fill="currentColor" />
            <rect x="6.5" y="7" width="11" height="2" rx="1" fill="#fff" />
            <rect x="6.5" y="11" width="11" height="2" rx="1" fill="#fff" />
            <rect x="6.5" y="15" width="7" height="2" rx="1" fill="#fff" />
          </svg>
          <span className="brand__word">
            <span className="brand__word-1">simple</span>
            <span className="brand__word-2">wiki</span>
          </span>
        </Link>
        <SearchBox />
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
