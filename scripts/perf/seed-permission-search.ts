// Run only against the disposable localhost:55433/wiki_permission_perf database.
import { PrismaClient } from "@prisma/client";
import { statfsSync } from "node:fs";

const url = new URL(process.env.DATABASE_URL ?? "");
if (url.hostname !== "127.0.0.1" || url.port !== "55433" || url.pathname !== "/wiki_permission_perf") throw Error("Dedicated performance database required");
const users = Number(process.env.PERF_USERS ?? 10_000_000);
const groups = Number(process.env.PERF_GROUPS ?? 100_000);
if (![users, groups].every(n => Number.isSafeInteger(n) && n > 0) || groups > users) throw Error("Invalid dataset size");
const db = new PrismaClient();
const start = Date.now();
async function main() {
try {
  if (await db.user.count() || await db.wikiGroup.count()) throw Error("Performance database must be empty");
  // Unlogged fixture tables avoid generating gigabytes of WAL. Query/index paths
  // are unchanged; this benchmark does not measure writes or crash recovery.
  for (const table of ["WikiGroupMember", "Like", "Comment", "ApiToken", "User", "WikiGroup"]) {
    await db.$executeRawUnsafe(`ALTER TABLE "${table}" SET UNLOGGED`);
  }
  await db.$executeRaw`INSERT INTO "WikiGroup" (id, name) SELECT 'g' || lpad(n::text, 8, '0'),
    (ARRAY['플랫폼','서비스','운영','개발','디자인'])[n % 5 + 1] || ' 팀 ' || lpad(n::text,8,'0') FROM generate_series(1, ${groups}::int) n`;
  for (let from = 1; from <= users; from += 100_000) {
    const fs = statfsSync(process.cwd());
    if (fs.bavail * fs.bsize < 6 * 1024 ** 3) throw Error("Stopped before disk reserve falls below 6 GiB");
    const to = Math.min(from + 99_999, users);
    await db.$executeRaw`INSERT INTO "User" (id, name, username, email) SELECT 'u' || lpad(n::text,8,'0'),
      CASE WHEN n % 10 = 0 THEN '김민수' WHEN n % 10 = 1 THEN '개발팀 사용자 ' || lpad(n::text,8,'0')
      WHEN n % 10 = 2 THEN 'Alice ' || substr(md5(n::text),1,6)
      ELSE (ARRAY['이서연','박지훈','최지우','정하은','한도윤'])[n % 5 + 1] || ' ' || lpad(n::text,8,'0') END,
      'user' || lpad(n::text,8,'0'), 'user' || lpad(n::text,8,'0') || '@bench.example'
      FROM generate_series(${from}::int, ${to}::int) n`;
    await db.$executeRaw`INSERT INTO "WikiGroupMember" (id, "groupId", "userId") SELECT 'm' || lpad(n::text,8,'0'),
      'g' || lpad(((n - 1) % ${groups}::int + 1)::text,8,'0'), 'u' || lpad(n::text,8,'0') FROM generate_series(${from}::int, ${to}::int) n`;
    console.log(JSON.stringify({ users: to, memberships: to, groups, elapsedSeconds: Math.round((Date.now() - start) / 1000), freeGiB: Math.round(fs.bavail * fs.bsize / 1024 ** 3) }));
  }
  await db.$executeRawUnsafe('ANALYZE "User"');
  await db.$executeRawUnsafe('ANALYZE "WikiGroup"');
  await db.$executeRawUnsafe('ANALYZE "WikiGroupMember"');
  console.log("seed complete");
} finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
