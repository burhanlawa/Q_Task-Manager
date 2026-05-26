import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';

// Server-side proxy: browser → /api/proxy/<path> → API_URL/api/v1/<path>.
// We never expose the Clerk JWT or the API URL to the browser; the proxy
// attaches the session token here and forwards everything else through.

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = new URL(`${API_URL}/api/v1/${path.join('/')}`);
  for (const [k, v] of req.nextUrl.searchParams) url.searchParams.set(k, v);

  const { getToken } = await auth();
  const token = await getToken();
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  const contentType = req.headers.get('content-type');
  if (contentType) headers['content-type'] = contentType;

  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();

  const upstream = await fetch(url, { method: req.method, headers, body });
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
