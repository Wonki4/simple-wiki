import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const url = new URL(process.env.DATABASE_URL ?? "");
if (url.hostname !== "127.0.0.1" || url.port !== "55433" || url.pathname !== "/wiki_permission_perf") throw Error("Dedicated performance database required");
const db = new PrismaClient();
async function main() {
  try {
    const space = await db.space.create({ data: { key: "perf", name: "Permission performance fixture", visibility: "restricted" } });
    await db.$executeRaw`INSERT INTO "SpacePermission" (id, "spaceId", "subjectType", "subjectRef", role)
      SELECT 'p' || n, ${space.id}, 'user'::"SubjectType", 'u' || lpad(n::text,8,'0'),
      CASE WHEN n <= 64 THEN 'admin'::"SpaceRole" ELSE 'viewer'::"SpaceRole" END FROM generate_series(1,100000) n`;
    const tokens = Array.from({ length: 1024 }, () => `swk_${randomBytes(32).toString("base64url")}`);
    await db.apiToken.createMany({ data: tokens.map((raw, index) => ({ userId: `u${String(index % 64 + 1).padStart(8, "0")}`,
      name: "performance-fixture", prefix: raw.slice(0, 12), tokenHash: createHash("sha256").update(raw).digest("hex"), lastUsedAt: new Date() })) });
    writeFileSync("/private/tmp/wiki-perf-tokens.json", JSON.stringify(tokens), { mode: 0o600 });
    console.log(JSON.stringify({ actors: 64, tokens: tokens.length, spacePermissions: 100000 }));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
