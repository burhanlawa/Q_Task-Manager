-- Sprint 2 task 2.1: create all enum types per blueprint §5.
-- Prisma models referencing these enums are added in subsequent migrations.

CREATE TYPE "subscription_plan" AS ENUM ('starter', 'growth', 'enterprise');

CREATE TYPE "subscription_status" AS ENUM (
  'trialing',
  'active',
  'past_due',
  'paused',
  'cancelled',
  'expired'
);

CREATE TYPE "billing_cycle" AS ENUM ('monthly', 'annual');

CREATE TYPE "user_status" AS ENUM ('active', 'invited', 'suspended', 'deactivated');

CREATE TYPE "employment_status" AS ENUM ('employed', 'on_leave', 'terminated');

CREATE TYPE "leave_status" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

CREATE TYPE "org_role" AS ENUM ('ceo', 'manager', 'supervisor', 'employee', 'hr', 'admin');

CREATE TYPE "task_status" AS ENUM (
  'draft',
  'assigned',
  'in_progress',
  'submitted',
  'reassignment_requested',
  'approved',
  'rejected',
  'completed',
  'cancelled'
);

CREATE TYPE "task_priority" AS ENUM ('low', 'medium', 'high', 'urgent');

CREATE TYPE "file_purpose" AS ENUM (
  'task_attachment',
  'task_submission',
  'avatar',
  'company_logo'
);

CREATE TYPE "virus_scan_status" AS ENUM ('pending', 'clean', 'infected', 'error');

CREATE TYPE "notification_channel" AS ENUM ('in_app', 'email', 'push');

CREATE TYPE "broadcast_audience" AS ENUM ('all_company', 'branch', 'role', 'custom');

CREATE TYPE "invoice_status" AS ENUM ('draft', 'open', 'paid', 'void', 'uncollectible');

CREATE TYPE "payment_method" AS ENUM ('card', 'bank_transfer', 'fastpay', 'zaincash');

CREATE TYPE "payment_provider" AS ENUM ('paddle', 'stripe');
