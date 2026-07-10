"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/access";
import { generateToken } from "@/lib/api-auth";

export interface CreateTokenResult {
  ok: boolean;
  error?: string;
  token?: string; // 발급 직후 한 번만 노출되는 원문
  name?: string;
}

// 폼(useActionState)에서 호출: 토큰을 발급하고 원문을 한 번만 돌려준다.
export async function createApiToken(
  _prev: CreateTokenResult | null,
  formData: FormData,
): Promise<CreateTokenResult> {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "토큰 이름을 입력하세요." };

  const { raw, hash, prefix } = generateToken();
  await prisma.apiToken.create({
    data: { userId: session.userId, name, tokenHash: hash, prefix },
  });
  revalidatePath("/settings/tokens");
  return { ok: true, token: raw, name };
}

export async function revokeApiToken(tokenId: string) {
  const session = await requireSession();
  // 본인 토큰만 삭제 가능하도록 userId로 스코프
  await prisma.apiToken.deleteMany({ where: { id: tokenId, userId: session.userId } });
  revalidatePath("/settings/tokens");
}
