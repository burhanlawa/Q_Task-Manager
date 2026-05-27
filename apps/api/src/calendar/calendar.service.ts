import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

// Inputs to isWorkingDay. We accept just enough info to answer the question
// — callers fetch their own rows and pass the relevant slices. That keeps
// the service stateless and pure, which is what 10.6's unit test needs.

export type CalendarCompany = {
  /// Bitmask: bit 0 = Sunday ... bit 6 = Saturday.
  workingDays: number;
};

export type CalendarBranch = {
  id: string;
  /// Optional override of the company bitmask. NULL → inherit company.
  workingDays: number | null;
};

export type CalendarUser = {
  /// Approved leave window, inclusive. Either both set or both null.
  leaveStartDate: Date | null;
  leaveEndDate: Date | null;
};

export type CalendarHoliday = {
  date: Date;
  /// NULL = company-wide holiday; otherwise scoped to that branch only.
  branchId: string | null;
};

@Injectable()
export class CalendarService {
  /**
   * True if `date` is a working day for `user` at `branch` in `company`.
   *
   * The order of checks matters for the error messages we may surface later:
   *   1. weekend (per branch/company bitmask)
   *   2. company-wide holiday
   *   3. branch-local holiday
   *   4. user is on approved leave
   *
   * `date` is a Date object; we read it in UTC to avoid timezone drift in
   * tests. Production callers should normalize to the tenant's timezone
   * before passing the date in.
   */
  isWorkingDay(args: {
    company: CalendarCompany;
    branch: CalendarBranch;
    user: CalendarUser;
    holidays: CalendarHoliday[];
    date: Date;
  }): boolean {
    const { company, branch, user, holidays, date } = args;

    // 1. Weekend?
    const dow = date.getUTCDay(); // 0 = Sunday … 6 = Saturday
    const bitmask = branch.workingDays ?? company.workingDays;
    const isWorkingWeekday = (bitmask & (1 << dow)) !== 0;
    if (!isWorkingWeekday) return false;

    // 2 + 3. Holiday for this date (company-wide OR this branch)?
    const dateKey = isoDate(date);
    for (const h of holidays) {
      if (isoDate(h.date) !== dateKey) continue;
      // company-wide holiday or one scoped to this branch — both block work
      if (h.branchId === null || h.branchId === branch.id) return false;
      // a holiday scoped to a different branch is ignored
    }

    // 4. User on leave on this date?
    if (user.leaveStartDate && user.leaveEndDate) {
      const start = isoDate(user.leaveStartDate);
      const end = isoDate(user.leaveEndDate);
      if (dateKey >= start && dateKey <= end) return false;
    }

    return true;
  }

  /**
   * Convenience wrapper that pulls the inputs from the database. Used by
   * controllers that have just IDs and a date in hand. Keep the inner
   * `isWorkingDay` separate so it can be unit-tested without a DB.
   */
  async isWorkingDayForUser(
    db: Prisma.TransactionClient,
    args: { companyId: string; branchId: string; userId: string; date: Date },
  ): Promise<boolean> {
    const [company, branch, user, holidays] = await Promise.all([
      db.company.findUnique({
        where: { id: args.companyId },
        select: { workingDays: true },
      }),
      db.branch.findUnique({
        where: { id: args.branchId },
        select: { id: true, workingDays: true },
      }),
      db.user.findUnique({
        where: { id: args.userId },
        select: { leaveStartDate: true, leaveEndDate: true },
      }),
      db.holiday.findMany({
        where: {
          companyId: args.companyId,
          deletedAt: null,
          date: args.date,
          OR: [{ branchId: null }, { branchId: args.branchId }],
        },
        select: { date: true, branchId: true },
      }),
    ]);
    if (!company || !branch || !user) return false;
    return this.isWorkingDay({ company, branch, user, holidays, date: args.date });
  }
}

/** YYYY-MM-DD in UTC. Stable across DST shifts and timezones. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
