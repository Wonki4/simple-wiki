CREATE TABLE "TimelineReview" (
    "revisionId" TEXT PRIMARY KEY REFERENCES "PageRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "TimelineEntry" (
    "id" TEXT PRIMARY KEY,
    "revisionId" TEXT NOT NULL REFERENCES "TimelineReview"("revisionId") ON DELETE CASCADE ON UPDATE CASCADE,
    "pageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "kind" TEXT NOT NULL CHECK ("kind" IN ('decision', 'discussion')),
    "summary" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "eventDay" DATE NOT NULL,
    "explicitDate" BOOLEAN NOT NULL
);

CREATE UNIQUE INDEX "TimelineEntry_revisionId_fingerprint_key" ON "TimelineEntry"("revisionId", "fingerprint");
CREATE INDEX "TimelineEntry_pageId_fingerprint_version_idx" ON "TimelineEntry"("pageId", "fingerprint", "version");
CREATE INDEX "TimelineEntry_pageId_eventDay_idx" ON "TimelineEntry"("pageId", "eventDay");
CREATE INDEX "PageRevision_pageId_createdAt_id_idx" ON "PageRevision"("pageId", "createdAt", "id");
CREATE INDEX "Comment_pageId_createdAt_id_idx" ON "Comment"("pageId", "createdAt", "id");
DROP INDEX "Comment_pageId_idx";
