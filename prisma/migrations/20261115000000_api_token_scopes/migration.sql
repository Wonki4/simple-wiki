-- Preserve the access of existing integrations. A deleted space revokes its scoped tokens.
ALTER TABLE "ApiToken"
  ADD COLUMN "readOnly" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "spaceId" TEXT,
  ADD CONSTRAINT "ApiToken_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
