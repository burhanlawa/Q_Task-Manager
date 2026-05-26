// Client-side API helper. All calls go through /api/proxy on our own origin,
// which handles auth + URL rewriting. Never references API_URL directly so the
// browser bundle stays free of backend URLs.

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/proxy/${path.replace(/^\//, '')}`, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    type ErrBody = { message?: string | string[] };
    const eb = body as ErrBody | null;
    const msg = Array.isArray(eb?.message) ? eb.message.join(', ') : (eb?.message ?? res.statusText);
    throw new ApiError(msg, res.status, body);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
};

export type Branch = {
  id: string;
  companyId: string;
  name: string;
  code: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  timezone: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
