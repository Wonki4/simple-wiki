CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "SpaceVisibility" AS ENUM ('organization', 'restricted');

-- CreateEnum
CREATE TYPE "SpaceRole" AS ENUM ('viewer', 'editor', 'admin');

-- CreateEnum
CREATE TYPE "SubjectType" AS ENUM ('user', 'group');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Space" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "visibility" "SpaceVisibility" NOT NULL DEFAULT 'organization',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Space_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpacePermission" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "subjectType" "SubjectType" NOT NULL,
    "subjectRef" TEXT NOT NULL,
    "role" "SpaceRole" NOT NULL,

    CONSTRAINT "SpacePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "searchVector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("content", ''))) STORED,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageRevision" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageLink" (
    "id" TEXT NOT NULL,
    "fromPageId" TEXT NOT NULL,
    "toSpaceId" TEXT NOT NULL,
    "toSlug" TEXT NOT NULL,

    CONSTRAINT "PageLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "pageId" TEXT,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Space_key_key" ON "Space"("key");

-- CreateIndex
CREATE UNIQUE INDEX "SpacePermission_spaceId_subjectType_subjectRef_key" ON "SpacePermission"("spaceId", "subjectType", "subjectRef");

-- CreateIndex
CREATE UNIQUE INDEX "Page_spaceId_slug_key" ON "Page"("spaceId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "PageRevision_pageId_version_key" ON "PageRevision"("pageId", "version");

-- CreateIndex
CREATE INDEX "PageLink_toSpaceId_toSlug_idx" ON "PageLink"("toSpaceId", "toSlug");

-- CreateIndex
CREATE UNIQUE INDEX "PageLink_fromPageId_toSpaceId_toSlug_key" ON "PageLink"("fromPageId", "toSpaceId", "toSlug");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- AddForeignKey
ALTER TABLE "SpacePermission" ADD CONSTRAINT "SpacePermission_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageRevision" ADD CONSTRAINT "PageRevision_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageLink" ADD CONSTRAINT "PageLink_fromPageId_fkey" FOREIGN KEY ("fromPageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Page_searchVector_idx" ON "Page" USING GIN ("searchVector");
CREATE INDEX "Page_title_trgm_idx" ON "Page" USING GIN ("title" gin_trgm_ops);
