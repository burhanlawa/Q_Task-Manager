import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaAdminService } from '../prisma/prisma-admin.service';
import { BUILTIN_ROLES } from './builtin-roles';
import { BUILTIN_TAG_CATEGORIES } from './builtin-tag-categories';

type ClerkEmail = { id: string; email_address: string };
type ClerkUserCreated = {
  id: string;
  email_addresses?: ClerkEmail[];
  primary_email_address_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

function primaryEmail(data: ClerkUserCreated): string | null {
  const emails = data.email_addresses ?? [];
  if (emails.length === 0) return null;
  const primary = emails.find((e) => e.id === data.primary_email_address_id);
  return (primary ?? emails[0]).email_address;
}

function slugFromEmail(email: string, clerkUserId: string): string {
  const base =
    email
      .split('@')[0]
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-') ?? 'company';
  const suffix = clerkUserId.slice(-6).toLowerCase();
  return `${base}-${suffix}`.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

@Injectable()
export class ClerkWebhookService {
  private readonly log = new Logger(ClerkWebhookService.name);

  // Webhook handlers run before any tenant context exists — they create the
  // tenant. Use the owner-role admin client so we can write across tenants.
  constructor(private readonly prisma: PrismaAdminService) {}

  async onUserCreated(raw: Record<string, unknown>): Promise<void> {
    const data = raw as ClerkUserCreated;
    const clerkUserId = data.id;
    const email = primaryEmail(data);
    if (!email) {
      this.log.warn(`user.created ${clerkUserId} has no email; skipping`);
      return;
    }

    const existing = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (existing) {
      this.log.log(`user.created ${clerkUserId} already linked; skipping`);
      return;
    }

    // Invite path: an admin in some tenant pre-created a users row with this
    // email and status='invited' (no clerk_user_id yet). Link to that row
    // instead of provisioning a brand-new tenant.
    const invited = await this.prisma.user.findFirst({
      where: { email, clerkUserId: null, status: 'invited', deletedAt: null },
      select: { id: true, companyId: true },
    });
    if (invited) {
      await this.prisma.user.update({
        where: { id: invited.id },
        data: {
          clerkUserId,
          status: 'active',
          firstName: data.first_name ?? undefined,
          lastName: data.last_name ?? undefined,
        },
      });
      this.log.log(
        `Linked clerk user ${clerkUserId} to invited row in company ${invited.companyId}`,
      );
      return;
    }

    const displayName =
      [data.first_name, data.last_name].filter(Boolean).join(' ').trim() || email.split('@')[0];

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const company = await tx.company.create({
        data: {
          name: `${displayName}'s Workspace`,
          slug: slugFromEmail(email, clerkUserId),
          country: 'IQ',
        },
      });

      const branch = await tx.branch.create({
        data: { companyId: company.id, name: 'Main' },
      });

      const department = await tx.department.create({
        data: {
          companyId: company.id,
          branchId: branch.id,
          name: 'Executive',
          isAutoCreated: true,
        },
      });

      const user = await tx.user.create({
        data: {
          companyId: company.id,
          branchId: branch.id,
          departmentId: department.id,
          email,
          clerkUserId,
          firstName: data.first_name ?? null,
          lastName: data.last_name ?? null,
          displayName,
          orgRole: 'ceo',
          status: 'active',
        },
      });

      // Seed all six built-in roles for the new tenant. CEO and Admin get
      // wildcard; the rest get placeholder permission lists pending §4.13.
      await tx.role.createMany({
        data: BUILTIN_ROLES.map((r) => ({
          companyId: company.id,
          name: r.name,
          description: r.description,
          isBuiltin: true,
          permissions: r.permissions,
        })),
      });

      // Founder bootstrap (Sprint 6 task 6.1):
      // 1. Link to CEO + Admin built-in roles (both wildcard — the founder
      //    needs to be able to do anything in their fresh tenant).
      // 2. Set the Executive department's manager_id to the founder, so the
      //    spec's "Manager of Executive" labeling has a real DB pointer.
      const founderRoles = await tx.role.findMany({
        where: { companyId: company.id, name: { in: ['CEO', 'Admin'] }, isBuiltin: true },
        select: { id: true },
      });
      await tx.userRole.createMany({
        data: founderRoles.map((r) => ({ userId: user.id, roleId: r.id })),
      });

      await tx.department.update({
        where: { id: department.id },
        data: { managerId: user.id },
      });

      // Seed 4 default tag categories (Sprint 6 task 6.2). Just the category
      // names — tags inside each are user-populated.
      await tx.tagCategory.createMany({
        data: BUILTIN_TAG_CATEGORIES.map((c, i) => ({
          companyId: company.id,
          name: c.name,
          position: i,
          isBuiltin: true,
        })),
      });

      this.log.log(`Provisioned company ${company.id} for clerk user ${clerkUserId}`);
    });
  }
}
