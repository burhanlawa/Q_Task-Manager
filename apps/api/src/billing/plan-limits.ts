// Plan → limits (blueprint §3.2 / Sprint 19.3).
//
//   starter (Free):    3 users     | 1 GB total
//   growth  (Pro):     unlimited   | 10 GB + 1 GB / active user
//   enterprise:        unlimited   | unlimited (sentinel)
//
// Number.MAX_SAFE_INTEGER stands in for "no limit" so callers can do a
// plain numeric comparison without a special case. The bigint cast in
// storage math preserves the sentinel through the arithmetic.

const GB = 1024n * 1024n * 1024n;
const UNLIMITED_USERS = Number.MAX_SAFE_INTEGER;
const UNLIMITED_STORAGE = BigInt(Number.MAX_SAFE_INTEGER);

export type PlanKey = 'starter' | 'growth' | 'enterprise';

export type PlanLimits = {
  maxUsers: number;
  // Returns the storage cap given the current active-user count, since
  // growth scales with seat count.
  storageBytes: (activeUserCount: number) => bigint;
};

export const PLAN_LIMITS: Record<PlanKey, PlanLimits> = {
  starter: {
    maxUsers: 3,
    storageBytes: () => 1n * GB,
  },
  growth: {
    maxUsers: UNLIMITED_USERS,
    storageBytes: (activeUserCount) => 10n * GB + BigInt(Math.max(activeUserCount, 0)) * GB,
  },
  enterprise: {
    maxUsers: UNLIMITED_USERS,
    storageBytes: () => UNLIMITED_STORAGE,
  },
};

// Defensive lookup — if a future plan slips through unhandled, fall back
// to the strictest known limit rather than no limit at all.
export function limitsFor(plan: string): PlanLimits {
  return PLAN_LIMITS[plan as PlanKey] ?? PLAN_LIMITS.starter;
}

export function isUnlimitedUsers(maxUsers: number): boolean {
  return maxUsers === UNLIMITED_USERS;
}
