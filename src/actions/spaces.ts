"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/access";

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
