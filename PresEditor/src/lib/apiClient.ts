// Talks to the self-hosted backend in /server (Fastify + MongoDB). Session
// auth is a plain httpOnly cookie set by the API on signin/signup; every
// call here just needs credentials:'include' so the browser attaches it —
// no token handling on this side. In dev, Vite proxies /api to the API
// (vite.config.js), so these are same-origin relative paths; VITE_API_URL
// only matters for a build served from somewhere that isn't proxied.
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) || '';

export interface AuthUser {
  email: string;
  displayName: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  thumbnail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFull {
  id: string;
  title: string;
  json: unknown;
  thumbnail: string | null;
  updatedAt: string;
}

// `status` lets callers (AuthContext.tsx in particular) tell a genuine 401
// ("no session") apart from any other non-2xx response. That distinction
// matters because a dev-mode Vite proxy (or a prod reverse proxy) answers
// with an actual HTTP error page (502/504, not a network-level fetch
// rejection) when the backend itself is unreachable — so "got an ApiError"
// alone does NOT mean "confirmed not authenticated".
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    // Only set Content-Type when there's actually a body — Fastify's JSON
    // body parser rejects an empty body when Content-Type says JSON (would
    // 400 every bodyless DELETE/POST call otherwise).
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new ApiError(body.error || `Erreur serveur (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---- auth ----
export function signup(email: string, password: string, displayName: string) {
  return request<AuthUser>('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, displayName }) });
}

export function signin(email: string, password: string) {
  return request<AuthUser>('/api/auth/signin', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function signout() {
  return request<{ ok: true }>('/api/auth/signout', { method: 'POST' });
}

export function me() {
  return request<AuthUser>('/api/auth/me');
}

// ---- projects ----
export function listProjects() {
  return request<ProjectSummary[]>('/api/projects');
}

export function getProject(id: string) {
  return request<ProjectFull>(`/api/projects/${id}`);
}

export function createProject(title: string, json: unknown) {
  return request<ProjectSummary>('/api/projects', { method: 'POST', body: JSON.stringify({ title, json }) });
}

export function updateProject(id: string, title: string, json: unknown) {
  return request<{ ok: true }>(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify({ title, json }) });
}

export function renameProject(id: string, title: string) {
  return request<{ ok: true }>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
}

export function updateProjectThumbnail(id: string, thumbnail: string | null) {
  return request<{ ok: true }>(`/api/projects/${id}/thumbnail`, { method: 'PUT', body: JSON.stringify({ thumbnail }) });
}

export function duplicateProject(id: string) {
  return request<ProjectSummary>(`/api/projects/${id}/duplicate`, { method: 'POST' });
}

export function deleteProject(id: string) {
  return request<{ ok: true }>(`/api/projects/${id}`, { method: 'DELETE' });
}
