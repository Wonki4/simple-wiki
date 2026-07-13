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

  await prisma.spacePermission.upsert({
    where: {
      spaceId_subjectType_subjectRef: { spaceId: eng.id, subjectType: "group", subjectRef: "/engineering" },
    },
    update: { role: "editor" },
    create: { spaceId: eng.id, subjectType: "group", subjectRef: "/engineering", role: "editor" },
  });

  console.log("seed 완료: notice(organization), eng(restricted, /engineering=editor)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
