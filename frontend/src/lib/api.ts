// Thin API client. The access token lives in localStorage; every request sends it as a bearer token.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const TOKEN_KEY = "aico.token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable (private mode): the session lasts until reload
  }
}

/** A failed API call. `status` is the HTTP status, or 0 when the server could not be reached at all. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }

  get isNetwork() {
    return this.status === 0;
  }
}

/** What to tell the user when the response carries no usable `detail`. */
function statusMessage(status: number, statusText: string): string {
  if (status === 401) return "Your session has expired. Sign in again.";
  if (status === 403) return "You don't have permission to do this.";
  if (status === 404) return "Not found. It may have been deleted.";
  if (status === 413) return "The file is too large.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  if (status >= 500) return `The server hit an error (${status}). Try again in a moment.`;
  return `${status} ${statusText}`.trim();
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new ApiError(0, "Can't reach the Orchestria server. Check your connection, or that the API is running.");
  }
}

async function failure(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // non-JSON error body (proxy error page, crash)
  }
  // Server errors never show internal details; client errors explain what to fix.
  const fallback = statusMessage(response.status, response.statusText);
  return new ApiError(response.status, response.status >= 500 ? fallback : errorMessage(body, fallback));
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail.map((d) => (d && typeof d === "object" && "msg" in d ? String(d.msg) : String(d))).join("; ");
    }
  }
  return fallback;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await send(path, { ...init, headers });
  if (response.status === 401 && token) {
    setToken(null);
    try {
      window.localStorage.removeItem("aico.user");
    } catch {
      // storage unavailable
    }
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
  }
  if (!response.ok) throw await failure(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });

export async function download(artifactId: string, name: string): Promise<void> {
  const response = await send(`/api/artifacts/${artifactId}/download`, {
    headers: { Authorization: `Bearer ${getToken() ?? ""}` },
  });
  if (!response.ok) throw await failure(response);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** A file's contents as text, for previews. */
export async function fetchText(artifactId: string): Promise<string> {
  const response = await send(`/api/artifacts/${artifactId}/download`, {
    headers: { Authorization: `Bearer ${getToken() ?? ""}` },
  });
  if (!response.ok) throw await failure(response);
  return response.text();
}

export async function upload(projectId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return api(`/api/projects/${projectId}/files`, { method: "POST", body: form });
}
