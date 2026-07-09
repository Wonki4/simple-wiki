"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession, requireSpaceRole } from "@/lib/access";

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

export async function addSpacePermission(spaceKey: string, formData: FormData) {
  const { space } = await requireSpaceRole(spaceKey, "admin");
  const subjectType = formData.get("subjectType") === "group" ? "group" : "user";
  const subjectValue = String(formData.get("subjectValue") ?? "").trim();
  const roleInput = String(formData.get("role") ?? "viewer");
  const role = roleInput === "admin" ? "admin" : roleInput === "editor" ? "editor" : "viewer";
  if (!subjectValue) throw new Error("대상을 입력하세요.");

  let subjectRef = subjectValue;
  if (subjectType === "user") {
    const user = await prisma.user.findFirst({ where: { email: subjectValue } });
    if (!user) throw new Error("해당 이메일의 사용자가 없습니다. 사용자가 최소 1회 로그인해야 합니다.");
    subjectRef = user.id;
  } else if (!subjectValue.startsWith("/")) {
    throw new Error('그룹 경로는 "/"로 시작해야 합니다. 예: /engineering');
  }

  await prisma.spacePermission.upsert({
    where: { spaceId_subjectType_subjectRef: { spaceId: space.id, subjectType, subjectRef } },
    update: { role },
    create: { spaceId: space.id, subjectType, subjectRef, role },
  });
  revalidatePath(`/s/${spaceKey}/settings`);
}

export async function removeSpacePermission(spaceKey: string, permissionId: string) {
  const { space } = await requireSpaceRole(spaceKey, "admin");
  await prisma.spacePermission.deleteMany({ where: { id: permissionId, spaceId: space.id } });
  revalidatePath(`/s/${spaceKey}/settings`);
}
