import { api, ApiError } from '../api';
import { supabase } from '../supabase';
jest.mock('../env', () => ({ env: { apiBaseUrl: 'https://example.test/api/v1/' } }));
jest.mock('../supabase', () => ({ supabase: { auth: { getSession: jest.fn(), refreshSession: jest.fn(), signOut: jest.fn() } } }));
const fetchMock = jest.fn();
const session = { access_token: 'test-token' };
function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return { status, ok: status >= 200 && status < 300, headers: new Headers(headers), json: async () => body };
}
beforeEach(() => {
  jest.useRealTimers();
  globalThis.fetch = fetchMock;
  fetchMock.mockReset();
  jest.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session }, error: null } as never);
  jest.mocked(supabase.auth.signOut).mockResolvedValue({ error: null });
});
it('unwraps data and enforces mobile and session headers for Headers input', async () => {
  fetchMock.mockResolvedValue(response(200, { ok: true, data: { value: 1 } }));
  await expect(api('/me', { headers: new Headers({ 'x-covva-client': 'web', authorization: 'bad', 'x-request-id': 'test' }) })).resolves.toEqual({ value: 1 });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://example.test/api/v1/me');
  expect(init.headers.get('x-covva-client')).toBe('mobile');
  expect(init.headers.get('authorization')).toBe('Bearer test-token');
  expect(init.headers.get('x-request-id')).toBe('test');
});
it.each([[400, 'invalid_input'], [403, 'forbidden'], [422, 'business_rule'], [503, 'unavailable']])('maps %s errors without losing message or details', async (status, code) => {
  const details = { reason: 'insurer_web_only', portalUrl: 'https://example.test/portal' };
  fetchMock.mockResolvedValue(response(status, { ok: false, error: { code, message: 'Customer-facing message', details } }));
  await expect(api('/me')).rejects.toMatchObject({ name: 'ApiError', code, status, message: 'Customer-facing message', details });
});
it('refreshes only once on 401 and uses the refreshed token', async () => {
  fetchMock.mockResolvedValueOnce(response(401, {})).mockResolvedValueOnce(response(200, { ok: true, data: 'ok' }));
  jest.mocked(supabase.auth.refreshSession).mockResolvedValue({ data: { session }, error: null } as never);
  jest.mocked(supabase.auth.getSession).mockResolvedValueOnce({ data: { session }, error: null } as never).mockResolvedValueOnce({ data: { session: { access_token: 'fresh-token' } }, error: null } as never);
  await expect(api('/me')).resolves.toBe('ok');
  expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[1][1].headers.get('authorization')).toBe('Bearer fresh-token');
});
it('signs out after a second 401', async () => {
  fetchMock.mockResolvedValue(response(401, {}));
  jest.mocked(supabase.auth.refreshSession).mockResolvedValue({ data: { session }, error: null } as never);
  await expect(api('/me')).rejects.toMatchObject({ code: 'unauthorised', status: 401 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
});
it('maps network and malformed responses', async () => {
  fetchMock.mockRejectedValueOnce(new TypeError('offline'));
  await expect(api('/me')).rejects.toMatchObject({ code: 'network_error', status: 0 });
  fetchMock.mockResolvedValueOnce({ ...response(502, {}), json: async () => { throw new Error('HTML'); } });
  await expect(api('/me')).rejects.toMatchObject({ code: 'invalid_response', status: 502 });
  fetchMock.mockResolvedValueOnce(response(500, { ok: true, data: {} }));
  await expect(api('/me')).rejects.toBeInstanceOf(ApiError);
});
it('honours Retry-After and does not replay writes', async () => {
  jest.useFakeTimers();
  fetchMock.mockResolvedValueOnce(response(429, { ok: false, error: { code: 'rate_limited', message: 'Wait' } }, { 'Retry-After': '5' }));
  await expect(api('/me', { method: 'POST' })).rejects.toMatchObject({ code: 'rate_limited', retryAfter: 5 });
  await expect(api('/me')).rejects.toMatchObject({ code: 'rate_limited' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(5001);
  fetchMock.mockResolvedValueOnce(response(200, { ok: true, data: true }));
  await expect(api('/me')).resolves.toBe(true);
  jest.useRealTimers();
});
