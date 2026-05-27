// Plan → storage limit math (blueprint §3.2).
//   starter (Free): 1 GB total
//   growth  (Pro):  10 GB + 1 GB per active user
//   enterprise:     unlimited (Number.MAX_SAFE_INTEGER as the sentinel — far
//                   beyond any realistic R2 bucket size, so the check passes
//                   without a special-case branch in the controller).
//
// Add-on storage blocks ($5/50 GB) are tracked separately when billing lands;
// for now they're not modelled.

const GB = 1024n * 1024n * 1024n;

export function storageLimitBytes(plan: string, activeUserCount: number): bigint {
  switch (plan) {
    case 'starter':
      return 1n * GB;
    case 'growth':
      return 10n * GB + BigInt(Math.max(activeUserCount, 0)) * GB;
    case 'enterprise':
      return BigInt(Number.MAX_SAFE_INTEGER);
    default:
      // Defensive default — if a future plan slips through unhandled, fall
      // back to the strictest known limit rather than no limit at all.
      return 1n * GB;
  }
}
