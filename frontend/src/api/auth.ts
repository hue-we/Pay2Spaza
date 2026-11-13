import { Role, Session } from '../auth/session';
import { BASE_URL, USE_MOCK } from './index';

export type AuthResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function post(path: string, payload: object): Promise<{ status: number; body: any } | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(BASE_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const REQUEST_PATH = '/api/auth/otp/request';
const CONFIRM_PATH = '/api/auth/otp/confirm';

// Mock mode: any number works and the code is always 123456.
export async function requestOtp(a: { phone: string; role: Role; merchantId?: string }): Promise<AuthResult> {
  if (USE_MOCK) {
    await wait(500);
    return { ok: true };
  }
  const r = await post(REQUEST_PATH, { ...a, identifier: a.phone });
  if (!r) return { ok: false, error: 'network' };
  return r.body?.success ? { ok: true } : { ok: false, error: r.body?.error ?? 'failed' };
}

export async function confirmOtp(a: {
  phone: string;
  code: string;
  role: Role;
  merchantId?: string;
}): Promise<AuthResult<{ session: Session }>> {
  if (USE_MOCK) {
    await wait(500);
    return a.code === '123456'
      ? { ok: true, session: { role: a.role, phone: a.phone, merchantId: a.merchantId } }
      : { ok: false, error: 'failed' };
  }
  const r = await post(CONFIRM_PATH, { ...a, identifier: a.phone });
  if (!r) return { ok: false, error: 'network' };
  if (!r.body?.success) return { ok: false, error: r.body?.error ?? 'failed' };
  const d = r.body.data ?? {};
  return {
    ok: true,
    session: {
      role: d.role === 'owner' || d.role === 'customer' ? d.role : a.role,
      phone: a.phone,
      merchantId: d.merchantId ?? a.merchantId,
      token: d.token,
    },
  };
}
