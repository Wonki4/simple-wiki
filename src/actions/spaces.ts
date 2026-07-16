"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession, requireSpaceRole } from "@/lib/access";
import { storage } from "@/lib/storage";
import { findUserByEmailOrUsername } from "@/lib/users";

const SPACE_KEY_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

export async function createSpace(formData: FormData) {
  const session = await requireSession();
  if (!session.isWikiAdmin) redirect("/denied");

  const key = String(formData.get("key") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const visibility = formData.get("visibility") === "restricted" ? "restricted" : "organization";

  if (!SPACE_KEY_RE.test(key)) throw new Error("키는 소문자/숫자/하이픈 2~32자여야 합니다.");
  if (!name) throw new Error("이름을 입력하세요.");
  const dup = await prisma.space.findUnique({ where: { key } });
  if (dup) throw new Error("이미 존재하는 키입니다.");

  await prisma.space.create({ data: { key, name, description, visibility } });
  revalidatePath("/");
  redirect(`/s/${key}`);
}

export async function updateSpaceVisibility(spaceKey: string, formData: FormData) {
  const { space } = await requireSpaceRole(spaceKey, "admin");
  const visibility = formData.get("visibility") === "restricted" ? "restricted" : "organization";
  await prisma.space.update({ where: { id: space.id }, data: { visibility } });
  revalidatePath(`/s/${spaceKey}/settings`);
  revalidatePath("/");
}

function parseRole(v: FormDataEntryValue | null) {
  const s = String(v ?? "viewer");
  return s === "admin" ? "admin" : s === "editor" ? "editor" : "viewer";
}

export async function addGroupPermission(spaceKey: string, formData: FormData) {
  const { space } = await requireSpaceRole(spaceKey, "admin");
  const groupId = String(formData.get("groupId") ?? "");
  const role = parseRole(formData.get("role"));
  const group = await prisma.wikiGroup.findUnique({ where: { id: groupId } });
  if (!group) {
    // 드롭다운 우회/경합 케이스 — 크래시 대신 배너로 안내하고 서버 로그를 남긴다.
    console.warn(`[perm] 그룹 권한 추가 실패 — 존재하지 않는 그룹 (space=${spaceKey}, groupId=${JSON.stringify(groupId)})`);
    redirect(`/s/${spaceKey}/settings?error=${encodeURIComponent("존재하지 않는 그룹입니다.")}`);
  }

  await prisma.spacePermission.upsert({
    where: { spaceId_subjectType_subjectRef: { spaceId: space.id, subjectType: "group", subjectRef: group.id } },
    update: { role },
    create: { spaceId: space.id, subjectType: "group", subjectRef: group.id, role },
  });
  revalidatePath(`/s/${spaceKey}/settings`);
  // 성공 시에도 쿼리 없는 경로로 — 이전 에러 배너가 URL에 남지 않게.
  redirect(`/s/${spaceKey}/settings`);
}

export async function addUserPermission(spaceKey: string, formData: FormData) {
  const { space } = await requireSpaceRole(spaceKey, "admin");
  const value = String(formData.get("email") ?? "").trim();
  const role = parseRole(formData.get("role"));
  if (!value) redirect(`/s/${spaceKey}/settings?error=${encodeURIComponent("이메일 또는 아이디를 입력하세요.")}`);
  const user = await findUserByEmailOrUsername(value);
  if (!user) {
    console.warn(`[perm] 사용자 권한 추가 실패 — 사용자 없음 (space=${spaceKey}, 입력=${JSON.stringify(value)})`);
    redirect(
      `/s/${spaceKey}/settings?error=${encodeURIComponent(
        "해당 이메일 또는 아이디의 사용자가 없습니다. 사용자가 최소 1회 로그인해야 하며, 아이디 검색은 다음 로그인부터 가능합니다.",
      )}`,
    );
  }

  await prisma.spacePermission.upsert({
    where: { spaceId_subjectType_subjectRef: { spaceId: space.id, subjectType: "user", subjectRef: user.id } },
    update: { role },
    create: { spaceId: space.id, subjectType: "user", subjectRef: user.id, role },
  });
  revalidatePath(`/s/${spaceKey}/settings`);
  redirect(`/s/${spaceKey}/settings`);
}

export async function removeSpacePermission(spaceKey: string, permissionId: string) {
  const { space } = await requireSpaceRole(spaceKey, "admin");
  await prisma.spacePermission.deleteMany({ where: { id: permissionId, spaceId: space.id } });
  revalidatePath(`/s/${spaceKey}/settings`);
}

export async function deleteSpace(spaceKey: string) {
  const session = await requireSession();
  if (!session.isWikiAdmin) redirect("/denied");
  const space = await prisma.space.findUnique({ where: { key: spaceKey } });
  if (!space) redirect("/");
  // Page/PageRevision/PageLink/SpacePermission/Attachment 레코드는 onDelete: Cascade로 함께 삭제된다.
  try {
    await prisma.space.delete({ where: { id: space.id } });
  } catch (e) {
    // 동시 이중 삭제(P2025)면 이미 삭제된 것 — 구 deleteMany처럼 멱등하게 계속 진행
    if ((e as { code?: string }).code !== "P2025") throw e;
  }
  // 스토리지 오브젝트 정리는 베스트에포트 — 실패해도 스페이스 삭제는 유지한다.
  // 고아 오브젝트는 무해(키 유일·재사용 없음)하지만 반쯤 롤백된 삭제가 더 나쁘다.
  try {
    await storage.deletePrefix(space.id);
  } catch (e) {
    console.error(`[storage] 스페이스 ${spaceKey}(${space.id}) 첨부 정리 실패:`, e);
  }
  revalidatePath("/");
  redirect("/");
}
