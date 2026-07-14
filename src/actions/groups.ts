"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/access";

async function requireWikiAdmin() {
  const session = await requireSession();
  if (!session.isWikiAdmin) redirect("/denied");
  return session;
}

export async function createGroup(formData: FormData) {
  await requireWikiAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("그룹 이름을 입력하세요.");
  const dup = await prisma.wikiGroup.findUnique({ where: { name } });
  if (dup) throw new Error("이미 존재하는 그룹입니다.");
  await prisma.wikiGroup.create({ data: { name } });
  revalidatePath("/groups");
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
  const email = String(formData.get("email") ?? "").trim();
  if (!email) throw new Error("이메일을 입력하세요.");
  const user = await prisma.user.findFirst({ where: { email } });
  if (!user) throw new Error("해당 이메일의 사용자가 없습니다. 사용자가 최소 1회 로그인해야 합니다.");
  // 이미 멤버면 조용히 성공(멱등) — 시드/재실행에 안전.
  await prisma.wikiGroupMember.upsert({
    where: { groupId_userId: { groupId, userId: user.id } },
    update: {},
    create: { groupId, userId: user.id },
  });
  revalidatePath("/groups");
}

export async function removeGroupMember(memberId: string) {
  await requireWikiAdmin();
  await prisma.wikiGroupMember.deleteMany({ where: { id: memberId } });
  revalidatePath("/groups");
}
