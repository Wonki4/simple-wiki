-- CreateIndex
CREATE INDEX "Page_content_trgm_idx" ON "Page" USING GIN ("content" gin_trgm_ops);
