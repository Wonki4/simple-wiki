CREATE TYPE "WikiItemKind" AS ENUM ('current', 'example', 'discussion');

CREATE TABLE "WikiTopic" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WikiTopic_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WikiTopic_spaceId_key_key" ON "WikiTopic"("spaceId", "key");
CREATE INDEX "WikiTopic_spaceId_updatedAt_key_idx" ON "WikiTopic"("spaceId", "updatedAt", "key");

CREATE TABLE "WikiTopicItem" (
    "topicId" TEXT NOT NULL REFERENCES "WikiTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "key" TEXT NOT NULL,
    "kind" "WikiItemKind" NOT NULL,
    "text" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL REFERENCES "PageRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WikiTopicItem_pkey" PRIMARY KEY ("topicId", "key")
);

CREATE INDEX "WikiTopicItem_revisionId_idx" ON "WikiTopicItem"("revisionId");

CREATE TABLE "WikiTopicUpdate" (
    "topicId" TEXT NOT NULL REFERENCES "WikiTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "version" INTEGER NOT NULL,
    "revisionId" TEXT NOT NULL REFERENCES "PageRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "digest" TEXT NOT NULL,
    CONSTRAINT "WikiTopicUpdate_pkey" PRIMARY KEY ("topicId", "version")
);

CREATE INDEX "WikiTopicUpdate_revisionId_idx" ON "WikiTopicUpdate"("revisionId");
CREATE UNIQUE INDEX "WikiTopicUpdate_topicId_revisionId_digest_key" ON "WikiTopicUpdate"("topicId", "revisionId", "digest");
