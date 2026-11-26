CREATE TABLE "SpaceFavorite" (
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,

    CONSTRAINT "SpaceFavorite_pkey" PRIMARY KEY ("userId", "spaceId"),
    CONSTRAINT "SpaceFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaceFavorite_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SpaceFavorite_spaceId_idx" ON "SpaceFavorite"("spaceId");
