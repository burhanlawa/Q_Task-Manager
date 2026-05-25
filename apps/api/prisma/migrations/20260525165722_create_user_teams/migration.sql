-- CreateTable
CREATE TABLE "user_teams" (
    "user_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_teams_pkey" PRIMARY KEY ("user_id","team_id")
);

-- CreateIndex
CREATE INDEX "idx_user_teams_team_id" ON "user_teams"("team_id");

-- AddForeignKey
ALTER TABLE "user_teams" ADD CONSTRAINT "user_teams_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_teams" ADD CONSTRAINT "user_teams_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique index: each user has at most one primary team.
-- Cannot be expressed in Prisma schema; raw SQL appended.
CREATE UNIQUE INDEX "idx_user_teams_primary" ON "user_teams"("user_id") WHERE "is_primary" = TRUE;
