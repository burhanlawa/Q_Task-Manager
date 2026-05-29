-- Sprint 16.3: extend broadcast_audience with team + department.
--
-- The 16.1 enum had {all_company, branch, role, custom}; the 16.3 spec
-- adds team + department as common audience kinds (people tend to think
-- in org structure, not abstract roles). We KEEP 'role' since 16.2 already
-- wired the resolver for it — both kinds coexist with no semantic overlap.
--
-- Postgres requires ADD VALUE statements to run OUTSIDE a transaction
-- block; Prisma migrate handles that automatically for ALTER TYPE ... ADD.

ALTER TYPE "broadcast_audience" ADD VALUE IF NOT EXISTS 'team';
ALTER TYPE "broadcast_audience" ADD VALUE IF NOT EXISTS 'department';
