import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { PermissionSearchResult, PermissionSubject } from "./permission-subjects";

const LIMIT = 10;
const MEMBER_COUNT_LIMIT = 1000;
type Candidate = { id: string; name: string; username: string | null; email: string; rank: number };
const userFields = ["name", "username", "email"] as const;
const groupFields = ["name"] as const;

export function canSearchSubstring(query: string) {
  // No extractable trigram means a full index scan (e.g. %, _, or two letters).
  return /[\p{L}\p{N}]{3}/u.test(query);
}

function candidatesQuery(type: "user" | "group", query: string, substring: boolean, excluded: string[] = []) {
  const table = Prisma.raw(type === "user" ? '"User"' : '"WikiGroup"');
  const columns = type === "user" ? userFields : groupFields;
  const fields = type === "user" ? Prisma.raw('id, name, username, email') : Prisma.raw("id, name, NULL::text AS username, ''::text AS email");
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const exclude = excluded.length ? Prisma.sql`AND id NOT IN (${Prisma.join(excluded)})` : Prisma.empty;
  // Bound EACH field before merging. Sorting all matches would otherwise turn a
  // common name/email domain into a multi-million-row scan despite LIMIT 10.
  const branches = columns.flatMap(column => {
    const field = Prisma.raw(`"${column}"`);
    if (substring) return [Prisma.sql`(SELECT ${fields}, 2::int AS rank FROM ${table}
      WHERE ${field} ILIKE ${pattern} ${exclude} LIMIT ${LIMIT + 1})`];
    return [
      Prisma.sql`(SELECT ${fields}, 0::int AS rank FROM ${table} WHERE (lower(${field}) COLLATE "C") = (lower(${query}) COLLATE "C") LIMIT ${LIMIT + 1})`,
      Prisma.sql`(SELECT ${fields}, 1::int AS rank FROM ${table} WHERE (lower(${field}) COLLATE "C") ^@ (lower(${query}) COLLATE "C") LIMIT ${LIMIT + 1})`,
    ];
  });
  return Prisma.join(branches, " UNION ALL ");
}

function uniqueCandidates(rows: Candidate[]) {
  const byId = new Map<string, Candidate>();
  for (const row of rows) if (!byId.has(row.id) || row.rank < byId.get(row.id)!.rank) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id));
}

export async function searchPermissionSubjects(spaceId: string, query: string): Promise<PermissionSearchResult> {
  if (!query.trim()) return { items: [], hasMore: false };
  return prisma.$transaction(async tx => {
    // Bound pathological queries as well as result size. Client abort alone does
    // not cancel an already-running database query.
    await tx.$executeRaw`SET LOCAL statement_timeout = '1500ms'`;
    async function find(type: "user" | "group") {
      let rows = uniqueCandidates(await tx.$queryRaw<Candidate[]>(candidatesQuery(type, query, false)));
      // An exact identifier/name already resolves the intended target. Avoid
      // probing huge trigram posting lists just to fill the remaining slots.
      if (rows.length <= LIMIT && !rows.some(row => row.rank === 0) && canSearchSubstring(query)) {
        rows = uniqueCandidates([...rows, ...await tx.$queryRaw<Candidate[]>(candidatesQuery(type, query, true, rows.map(row => row.id)))]);
      }
      return rows;
    }
    const users = await find("user");
    const groups = await find("group");
    const selectedUsers = users.slice(0, LIMIT);
    const selectedGroups = groups.slice(0, LIMIT);
    const groupIds = selectedGroups.map(g => g.id);
    // Count only selected groups, with a cap so a ten-million-member group does
    // not make autocomplete wait for an exact COUNT(*).
    const counts = groupIds.length ? await tx.$queryRaw<{ id: string; count: number }[]>(Prisma.sql`
      SELECT g.id, (SELECT count(*)::int FROM (SELECT 1 FROM "WikiGroupMember" m WHERE m."groupId" = g.id LIMIT ${MEMBER_COUNT_LIMIT + 1}) members) AS count
      FROM "WikiGroup" g WHERE g.id IN (${Prisma.join(groupIds)})`) : [];
    const memberCounts = new Map(counts.map(row => [row.id, row.count]));
    const permissions = selectedUsers.length || groupIds.length ? await tx.spacePermission.findMany({
      where: { spaceId, OR: [
        { subjectType: "user", subjectRef: { in: selectedUsers.map(u => u.id) } },
        { subjectType: "group", subjectRef: { in: groupIds } },
      ] }, select: { subjectType: true, subjectRef: true, role: true },
    }) : [];
    const roles = new Map(permissions.map(p => [`${p.subjectType}:${p.subjectRef}`, p.role]));
    const ranked: (PermissionSubject & { rank: number })[] = [
      ...selectedUsers.map(user => ({ id: user.id, type: "user" as const, rank: user.rank,
        label: user.name || user.username || user.email || "이름 없는 사용자",
        detail: [user.username, user.email].filter(Boolean).join(" · "), currentRole: roles.get(`user:${user.id}`) ?? null })),
      ...selectedGroups.map(group => ({ id: group.id, type: "group" as const, rank: group.rank, label: group.name,
        detail: (memberCounts.get(group.id) ?? 0) > MEMBER_COUNT_LIMIT ? "멤버 1,000명 이상" : `멤버 ${memberCounts.get(group.id) ?? 0}명`,
        currentRole: roles.get(`group:${group.id}`) ?? null })),
    ];
    ranked.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, "ko") || a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
    return { items: ranked.map(({ rank: _rank, ...item }) => item), hasMore: users.length > LIMIT || groups.length > LIMIT };
  }, { maxWait: 3000, timeout: 8000 });
}
