CREATE TABLE "PageHtml" (
    "pageId" TEXT NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "html" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageHtml_pkey" PRIMARY KEY ("pageId"),
    CONSTRAINT "PageHtml_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
