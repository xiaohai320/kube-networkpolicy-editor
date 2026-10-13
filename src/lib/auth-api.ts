/**
 * Frontend client for the auth endpoints. Cookie sessions: no tokens in JS,
 * just fetch with default credentials.
 */

export interface AuthMe {
  authenticated: boolean;
  user?: string;
  role?: 'admin' | 'user';
  warning?: string | null;
}

async function jsonOrThrow(res: Response): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = new Error(String(body.error ?? res.statusText)) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return body;
}

export async function fetchMe(): Promise<AuthMe> {
  const res = await fetch('/auth/me');
  return (await jsonOrThrow(res)) as unknown as AuthMe;
}

export async function login(username: string, password: string): Promise<void> {
  await jsonOrThrow(await fetch('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }));
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST' });
}

export async function startOidc(): Promise<void> {
  // Full navigation into the auth backend, not a fetch — the IdP takes over.
  window.location.href = '/auth/oidc/start';
}

export async function listUsers(): Promise<string[]> {
  const res = await fetch('/auth/users');
  return ((await jsonOrThrow(res)) as { users: string[] }).users;
}

export async function addUser(username: string): Promise<string[]> {
  const res = await fetch('/auth/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  return ((await jsonOrThrow(res)) as { users: string[] }).users;
}

export async function removeUser(username: string): Promise<string[]> {
  const res = await fetch(`/auth/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
  return ((await jsonOrThrow(res)) as { users: string[] }).users;
}

export async function changePassword(current: string, next: string): Promise<void> {
  await jsonOrThrow(await fetch('/auth/password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ current, next }),
  }));
}
