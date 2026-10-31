import type { ApiResult } from '@im/core';
import { env } from './env';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number, public readonly details?: unknown, public readonly retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
  }
}
let blockedUntil = 0;
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new ApiError('Invalid API path.', 'invalid_input', 0);
  if (Date.now() < blockedUntil) throw new ApiError('Please wait before trying again.', 'rate_limited', 429, undefined, Math.ceil((blockedUntil - Date.now()) / 1000));
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new ApiError(error.message, 'unauthorised', 401);
    const headers = new Headers(init.headers);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    headers.set('x-covva-client', 'mobile');
    headers.delete('authorization');
    if (data.session) headers.set('authorization', `Bearer ${data.session.access_token}`);
    let res: Response;
    try { res = await fetch(`${env.apiBaseUrl.replace(/\/$/, '')}${path}`, { ...init, headers }); }
    catch { throw new ApiError('Could not connect. Check your connection and try again.', 'network_error', 0); }
    if (res.status === 401) {
      if (attempt === 0) {
        const refreshed = await supabase.auth.refreshSession();
        if (!refreshed.error && refreshed.data.session) continue;
      }
      await supabase.auth.signOut({ scope: 'local' });
      throw new ApiError('Please sign in again.', 'unauthorised', 401);
    }
    let retryAfter: number | undefined;
    if (res.status === 429) {
      const raw = res.headers.get('retry-after');
      retryAfter = raw ? (/^\d+$/.test(raw) ? Number(raw) : Math.ceil((Date.parse(raw) - Date.now()) / 1000)) : 1;
      if (!Number.isFinite(retryAfter)) retryAfter = 1;
      retryAfter = Math.max(1, retryAfter);
      blockedUntil = Date.now() + retryAfter * 1000;
    }
    let body: ApiResult<T>;
    try { body = await res.json(); }
    catch { throw new ApiError('The server returned an unreadable response.', 'invalid_response', res.status, undefined, retryAfter); }
    if (body && body.ok === false && body.error && typeof body.error.message === 'string' && typeof body.error.code === 'string') {
      throw new ApiError(body.error.message, body.error.code, res.status, body.error.details, retryAfter);
    }
    if (!res.ok || !body || body.ok !== true || !('data' in body)) throw new ApiError('The server returned an unexpected response.', 'invalid_response', res.status);
    return body.data;
  }
  throw new ApiError('Please sign in again.', 'unauthorised', 401);
}
