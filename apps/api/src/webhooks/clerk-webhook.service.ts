import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaAdminService } from '../prisma/prisma-admin.service';

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

      // Built-in CEO role with wildcard permissions. Sprint 6 will seed the
      // other five built-in roles with their specific permission lists; for
      // now '*' lets the founder use every guarded endpoint without us having
      // to enumerate every permission key today.
      const ceoRole = await tx.role.create({
        data: {
          companyId: company.id,
          name: 'CEO',
          description: 'Founder; full access to every action in the tenant.',
          isBuiltin: true,
          permissions: ['*'],
        },
      });

      await tx.userRole.create({ data: { userId: user.id, roleId: ceoRole.id } });

      this.log.log(`Provisioned company ${company.id} for clerk user ${clerkUserId}`);
    });
  }
}
