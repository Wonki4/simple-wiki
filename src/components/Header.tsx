import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";

export async function Header() {
  const session = await auth();
  return (
    <header className="flex items-center gap-4 border-b border-gray-200 py-3">
      <Link href="/" className="font-bold">
        simple-wiki
      </Link>
      <form action="/search" method="GET" className="flex-1">
        <input
          type="search"
          name="q"
          placeholder="검색"
          className="w-full max-w-sm rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </form>
      {session?.user ? (
        <div className="flex items-center gap-2 text-sm">
          <span>{session.user.name}</span>
          <form
            action={async () => {
              "use server";
              await signOut();
            }}
          >
            <button className="text-gray-500 underline">로그아웃</button>
          </form>
        </div>
      ) : (
        <form
          action={async () => {
            "use server";
            await signIn("keycloak");
          }}
        >
          <button className="text-sm underline">로그인</button>
        </form>
      )}
    </header>
  );
}
