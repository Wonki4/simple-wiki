import { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { restoreTrashedPage } from "@/lib/page-trash";

export async function POST(req: NextRequest, ctx: { params: Promise<{ spaceKey: string; id: string }> }) {
  const { spaceKey, id } = await ctx.params;
  const auth = await requireApiSpaceRole(req, spaceKey, "editor");
  if (!auth.ok) return auth.response;
  const slug = req.nextUrl.searchParams.get("slug") ?? undefined;
  const result = await restoreTrashedPage(auth.space.id, id, slug);
  switch (result.status) {
    case "restored": return Response.json({ restored: true, slug: result.slug });
    case "missing": return Response.json({ error: "휴지통에 없는 문서입니다." }, { status: 404 });
    case "taken": return Response.json({ error: "주소가 사용 중입니다. slug로 다른 주소를 지정하세요." }, { status: 409 });
    case "invalid": return Response.json({ error: "다른 문서 주소를 지정하세요. new와 settings는 예약된 주소입니다." }, { status: 400 });
  }
}
