/**
 * Default tag categories seeded into every new tenant on signup
 * (Sprint 6 task 6.2). Just category placeholders; specific tags inside each
 * are created by users (or by later seed work in Sprint 9–10).
 *
 * Position matches array order so the UI shows them in this sequence.
 */
export const BUILTIN_TAG_CATEGORIES = [
  { name: 'Priority' },
  { name: 'Project' },
  { name: 'Department' },
  { name: 'Client' },
] as const;
