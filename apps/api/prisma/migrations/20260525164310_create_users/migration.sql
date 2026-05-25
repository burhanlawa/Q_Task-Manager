-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "department_id" UUID,
    "email" TEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ(6),
    "clerk_user_id" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "display_name" TEXT,
    "phone" TEXT,
    "avatar_file_id" UUID,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT,
    "org_role" "org_role" NOT NULL DEFAULT 'employee',
    "system_role" TEXT,
    "status" "user_status" NOT NULL DEFAULT 'invited',
    "employment_status" "employment_status" NOT NULL DEFAULT 'employed',
    "hired_at" DATE,
    "terminated_at" DATE,
    "national_id" BYTEA,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "idx_users_clerk_user_id" ON "users"("clerk_user_id");

-- CreateIndex
CREATE INDEX "idx_users_company_id" ON "users"("company_id");

-- CreateIndex
CREATE INDEX "idx_users_branch_id" ON "users"("branch_id");

-- CreateIndex
CREATE INDEX "idx_users_department_id" ON "users"("department_id");

-- CreateIndex
CREATE INDEX "idx_users_status" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "idx_users_company_email" ON "users"("company_id", "email");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
