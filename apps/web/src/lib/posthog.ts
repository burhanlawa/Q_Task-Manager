'use client';

import posthog from 'posthog-js';

let initialized = false;

export function initPostHog(): typeof posthog | null {
  if (typeof window === 'undefined') return null;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host =
    process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';

  if (!key) return null;
  if (initialized) return posthog;

  posthog.init(key, {
    api_host: host,
    capture_pageview: false,
    capture_pageleave: true,
  });
  initialized = true;
  return posthog;
}
