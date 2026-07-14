-- CreateTable
CREATE TABLE "WikiGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WikiGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WikiGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "WikiGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WikiGroup_name_key" ON "WikiGroup"("name");

-- CreateIndex
CREATE INDEX "WikiGroupMember_userId_idx" ON "WikiGroupMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WikiGroupMember_groupId_userId_key" ON "WikiGroupMember"("groupId", "userId");

-- AddForeignKey
ALTER TABLE "WikiGroupMember" ADD CONSTRAINT "WikiGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "WikiGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiGroupMember" ADD CONSTRAINT "WikiGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
