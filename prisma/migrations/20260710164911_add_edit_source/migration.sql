-- AlterTable
-- (Prisma가 생성한 `ALTER COLUMN "searchVector" DROP DEFAULT` 라인은 GENERATED tsvector 컬럼을 깨므로 제거함)
ALTER TABLE "Page" ADD COLUMN     "updatedSource" TEXT NOT NULL DEFAULT 'web',
ADD COLUMN     "updatedViaLabel" TEXT;

-- AlterTable
ALTER TABLE "PageRevision" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'web',
ADD COLUMN     "viaLabel" TEXT;
