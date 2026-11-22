-- Prefix operators can stop after a few matches, including one-character and
-- two-character queries. Expression indexes are maintained by this migration.
CREATE INDEX "User_name_prefix_idx" ON "User" USING spgist ((lower("name") COLLATE "C"));
CREATE INDEX "User_username_prefix_idx" ON "User" USING spgist ((lower("username") COLLATE "C"));
CREATE INDEX "User_email_prefix_idx" ON "User" USING spgist ((lower("email") COLLATE "C"));
CREATE INDEX "WikiGroup_name_prefix_idx" ON "WikiGroup" USING spgist ((lower("name") COLLATE "C"));

CREATE INDEX "User_name_trgm_idx" ON "User" USING gin ("name" gin_trgm_ops);
CREATE INDEX "User_username_trgm_idx" ON "User" USING gin ("username" gin_trgm_ops);
CREATE INDEX "User_email_trgm_idx" ON "User" USING gin ("email" gin_trgm_ops);
CREATE INDEX "WikiGroup_name_trgm_idx" ON "WikiGroup" USING gin ("name" gin_trgm_ops);
