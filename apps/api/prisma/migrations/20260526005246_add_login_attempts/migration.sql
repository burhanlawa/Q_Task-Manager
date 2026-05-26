-- CreateTable
CREATE TABLE "login_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "ip_address" INET,
    "user_agent" TEXT,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "attempted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_login_attempts_email_attempted_at" ON "login_attempts"("email", "attempted_at" DESC);

-- CreateIndex
CREATE INDEX "idx_login_attempts_ip_attempted_at" ON "login_attempts"("ip_address", "attempted_at" DESC);
