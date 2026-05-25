-- CreateTable
CREATE TABLE "user_system_roles" (
    "user_id" UUID NOT NULL,
    "system_role" TEXT NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by" UUID,

    CONSTRAINT "user_system_roles_pkey" PRIMARY KEY ("user_id","system_role")
);

-- CreateIndex
CREATE INDEX "idx_user_system_roles_system_role" ON "user_system_roles"("system_role");

-- AddForeignKey
ALTER TABLE "user_system_roles" ADD CONSTRAINT "user_system_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
