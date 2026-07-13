-- AddColumn
ALTER TABLE "Page" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Backfill: 각 페이지의 version을 최신 리비전 version으로 맞춘다.
UPDATE "Page" p
SET "version" = COALESCE(sub.maxv, 1)
FROM (
  SELECT "pageId", MAX("version") AS maxv
  FROM "PageRevision"
  GROUP BY "pageId"
) sub
WHERE sub."pageId" = p."id";
