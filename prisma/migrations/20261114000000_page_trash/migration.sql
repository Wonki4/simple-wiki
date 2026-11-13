ALTER TABLE "Page" ADD COLUMN "deletedAt" TIMESTAMP(3),
                   ADD COLUMN "deletedById" TEXT,
                   ADD COLUMN "deletedSlug" TEXT;
CREATE INDEX "Page_spaceId_deletedAt_idx" ON "Page"("spaceId", "deletedAt");
