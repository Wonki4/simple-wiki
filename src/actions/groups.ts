"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/access";
import { findUserByEmailOrUsername } from "@/lib/users";

async function requireWikiAdmin() {
  const session = await requireSession();
  if (!session.isWikiAdmin) redirect("/denied");
  return session;
}

export async function createGroup(formData: FormData) {
  await requireWikiAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect(`/groups?error=${encodeURIComponent("그룹 이름을 입력하세요.")}`);
  const dup = await prisma.wikiGroup.findUnique({ where: { name } });
  if (dup) {
    console.warn(`[perm] 그룹 생성 실패 — 중복 이름 (name=${JSON.stringify(name)})`);
    redirect(`/groups?error=${encodeURIComponent("이미 존재하는 그룹입니다.")}`);
  }
  await prisma.wikiGroup.create({ data: { name } });
  revalidatePath("/groups");
  redirect("/groups");
}

export async function deleteGroup(groupId: string) {
  await requireWikiAdmin();
  // 이 그룹을 가리키는 스페이스 권한도 같은 트랜잭션에서 삭제해 dangling ref를 막는다.
  await prisma.$transaction([
    prisma.spacePermission.deleteMany({ where: { subjectType: "group", subjectRef: groupId } }),
    prisma.wikiGroup.deleteMany({ where: { id: groupId } }),
  ]);
  revalidatePath("/groups");
  revalidatePath("/");
}

export async function addGroupMember(groupId: string, formData: FormData) {
  await requireWikiAdmin();
  const value = String(formData.get("email") ?? "").trim();
  if (!value) redirect(`/groups?error=${encodeURIComponent("이메일 또는 아이디를 입력하세요.")}`);
  const user = await findUserByEmailOrUsername(value);
  if (!user) {
    console.warn(`[perm] 그룹 멤버 추가 실패 — 사용자 없음 (groupId=${groupId}, 입력=${JSON.stringify(value)})`);
    redirect(
      `/groups?error=${encodeURIComponent(
        "해당 이메일 또는 아이디의 사용자가 없습니다. 사용자가 최소 1회 로그인해야 하며, 아이디 검색은 다음 로그인부터 가능합니다.",
      )}`,
    );
  }
  // 이미 멤버면 조용히 성공(멱등) — 시드/재실행에 안전.
  await prisma.wikiGroupMember.upsert({
    where: { groupId_userId: { groupId, userId: user.id } },
    update: {},
    create: { groupId, userId: user.id },
  });
  revalidatePath("/groups");
  redirect("/groups");
}

export async function removeGroupMember(memberId: string) {
  await requireWikiAdmin();
  await prisma.wikiGroupMember.deleteMany({ where: { id: memberId } });
  revalidatePath("/groups");
}
