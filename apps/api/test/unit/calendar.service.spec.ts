import { CalendarService } from '../../src/calendar/calendar.service';

// Iraq workweek bitmask: Sun(0) Mon(1) Tue(2) Wed(3) Thu(4) Fri Sat
// = bits 0..4 set = 0b0011111 = 31. Fri (5) + Sat (6) = weekend.
const IRAQ_WORKWEEK = 0b0011111;

// Pick fixed UTC dates with known weekdays so the test doesn't depend on
// the runner's timezone.
//   2026-05-31 (Sun) → working
//   2026-06-05 (Fri) → weekend
const SUN_2026_05_31 = new Date('2026-05-31T00:00:00Z');
const FRI_2026_06_05 = new Date('2026-06-05T00:00:00Z');
const MON_2026_06_01 = new Date('2026-06-01T00:00:00Z');
const TUE_2026_06_02 = new Date('2026-06-02T00:00:00Z');
const WED_2026_06_03 = new Date('2026-06-03T00:00:00Z');

describe('CalendarService.isWorkingDay (Sprint 10.6)', () => {
  const svc = new CalendarService();
  const company = { workingDays: IRAQ_WORKWEEK };
  const branch = { id: 'branch-a', workingDays: null };
  const userNoLeave = { leaveStartDate: null, leaveEndDate: null };

  it('returns true on a normal working day (Mon)', () => {
    expect(
      svc.isWorkingDay({
        company,
        branch,
        user: userNoLeave,
        holidays: [],
        date: MON_2026_06_01,
      }),
    ).toBe(true);
  });

  it('returns false on a weekend (Fri in Iraq workweek)', () => {
    expect(
      svc.isWorkingDay({
        company,
        branch,
        user: userNoLeave,
        holidays: [],
        date: FRI_2026_06_05,
      }),
    ).toBe(false);
  });

  it('returns false on a company-wide holiday (branchId NULL)', () => {
    expect(
      svc.isWorkingDay({
        company,
        branch,
        user: userNoLeave,
        holidays: [{ date: TUE_2026_06_02, branchId: null }],
        date: TUE_2026_06_02,
      }),
    ).toBe(false);
  });

  it('returns false on a branch-local holiday matching the user’s branch', () => {
    expect(
      svc.isWorkingDay({
        company,
        branch,
        user: userNoLeave,
        holidays: [{ date: WED_2026_06_03, branchId: 'branch-a' }],
        date: WED_2026_06_03,
      }),
    ).toBe(false);
  });

  it('ignores a holiday scoped to a different branch', () => {
    expect(
      svc.isWorkingDay({
        company,
        branch,
        user: userNoLeave,
        holidays: [{ date: WED_2026_06_03, branchId: 'branch-elsewhere' }],
        date: WED_2026_06_03,
      }),
    ).toBe(true);
  });

  it('returns false when the user is on approved leave that includes the date', () => {
    const onLeave = {
      leaveStartDate: new Date('2026-06-01T00:00:00Z'),
      leaveEndDate: new Date('2026-06-05T00:00:00Z'),
    };
    expect(
      svc.isWorkingDay({
        company,
        branch,
        user: onLeave,
        holidays: [],
        date: WED_2026_06_03,
      }),
    ).toBe(false);
  });

  it('treats leave window as inclusive at both ends', () => {
    const onLeave = {
      leaveStartDate: MON_2026_06_01,
      leaveEndDate: WED_2026_06_03,
    };
    expect(
      svc.isWorkingDay({ company, branch, user: onLeave, holidays: [], date: MON_2026_06_01 }),
    ).toBe(false);
    expect(
      svc.isWorkingDay({ company, branch, user: onLeave, holidays: [], date: WED_2026_06_03 }),
    ).toBe(false);
    expect(
      svc.isWorkingDay({ company, branch, user: onLeave, holidays: [], date: SUN_2026_05_31 }),
    ).toBe(true);
  });

  it('branch-level workingDays override beats company default', () => {
    const sundayOffBranch = { id: 'branch-a', workingDays: 0b0011110 }; // Sun off, Mon-Thu on
    expect(
      svc.isWorkingDay({
        company,
        branch: sundayOffBranch,
        user: userNoLeave,
        holidays: [],
        date: SUN_2026_05_31,
      }),
    ).toBe(false);
    // Mon still working under override
    expect(
      svc.isWorkingDay({
        company,
        branch: sundayOffBranch,
        user: userNoLeave,
        holidays: [],
        date: MON_2026_06_01,
      }),
    ).toBe(true);
  });
});
