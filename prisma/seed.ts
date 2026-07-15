import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.space.upsert({
    where: { key: "notice" },
    update: {},
    create: { key: "notice", name: "공지사항", description: "전사 공지", visibility: "organization" },
  });

  const eng = await prisma.space.upsert({
    where: { key: "eng" },
    update: {},
    create: { key: "eng", name: "엔지니어링", description: "엔지니어링 팀 위키", visibility: "restricted" },
  });

  // 위키 자체 그룹. 멤버는 사용자가 최소 1회 로그인한 뒤 /groups에서 추가한다(User.id = Keycloak sub).
  const engGroup = await prisma.wikiGroup.upsert({
    where: { name: "engineering" },
    update: {},
    create: { name: "engineering" },
  });

  // 구 시드의 Keycloak 경로 기반 권한 잔재 제거(있다면).
  await prisma.spacePermission.deleteMany({ where: { subjectType: "group", subjectRef: "/engineering" } });

  await prisma.spacePermission.upsert({
    where: {
      spaceId_subjectType_subjectRef: { spaceId: eng.id, subjectType: "group", subjectRef: engGroup.id },
    },
    update: { role: "editor" },
    create: { spaceId: eng.id, subjectType: "group", subjectRef: engGroup.id, role: "editor" },
  });

  console.log("seed 완료: notice(organization), eng(restricted, engineering 그룹=editor — 멤버는 /groups에서 추가)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
