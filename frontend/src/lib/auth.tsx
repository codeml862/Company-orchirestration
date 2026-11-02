"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { ApiError, api, getToken, setToken } from "./api";
import { readPreferences } from "./preferences";
import type { Role, User } from "./types";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  /** Signs in with an ID token ("credential") from Google Identity Services. */
  loginWithGoogle: (credential: string) => Promise<User>;
  /** Creates a client company with its first user, then signs in. */
  signup: (input: SignupInput) => Promise<User>;
  signupWithGoogle: (credential: string, companyName: string) => Promise<User>;
  logout: () => void;
  /** Replace the signed-in user after they edit their own profile. */
  updateUser: (user: User) => void;
  /** Set when the session could not be checked because the server was unreachable (nothing cached either). */
  connectionError: string | null;
  retry: () => void;
}

export interface SignupInput {
  company_name: string;
  full_name: string;
  email: string;
  password: string;
}

type TokenResponse = { access_token: string; user: User };

const AuthContext = createContext<AuthState | null>(null);

// The signed-in user is cached next to the token, so a page refresh shows the app immediately while
// the session is re-checked in the background. It holds nothing the token does not already grant.
const USER_KEY = "aico.user";

function readCachedUser(): User | null {
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function cacheUser(user: User | null) {
  try {
    if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(USER_KEY);
  } catch {
    // storage unavailable: the next refresh simply waits for the server
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const setUser = useCallback((next: User | null) => {
    setUserState(next);
    cacheUser(next);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      cacheUser(null);
      setLoading(false);
      return;
    }
    const cached = readCachedUser();
    if (cached) {
      setUserState(cached);
      setLoading(false);
    }
    setConnectionError(null);
    api<User>("/api/auth/me")
      .then(setUser)
      .catch((e) => {
        // Only an expired or revoked session signs you out; a server that is restarting does not.
        if (e instanceof ApiError && e.status === 401) {
          setToken(null);
          setUser(null);
        } else if (!cached) {
          setConnectionError(e instanceof Error ? e.message : "Can't reach the server");
        }
      })
      .finally(() => setLoading(false));
  }, [attempt, setUser]);

  const retry = useCallback(() => {
    setLoading(true);
    setAttempt((a) => a + 1);
  }, []);

  const signIn = useCallback(async (path: string, body: unknown) => {
    const response = await api<TokenResponse>(path, { method: "POST", body: JSON.stringify(body) });
    setToken(response.access_token);
    setUser(response.user);
    return response.user;
  }, [setUser]);

  const login = useCallback((email: string, password: string) => signIn("/api/auth/login", { email, password }), [signIn]);
  const loginWithGoogle = useCallback((credential: string) => signIn("/api/auth/google", { credential }), [signIn]);
  const signup = useCallback((input: SignupInput) => signIn("/api/auth/signup", input), [signIn]);
  const signupWithGoogle = useCallback(
    (credential: string, companyName: string) => signIn("/api/auth/google/signup", { credential, company_name: companyName }),
    [signIn],
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    window.location.href = "/login";
  }, [setUser]);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, loginWithGoogle, signup, signupWithGoogle, logout, updateUser: setUser, connectionError, retry }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export const isStaff = (role?: Role) => role === "admin" || role === "supervisor" || role === "operator";
export const isSupervisor = (role?: Role) => role === "admin" || role === "supervisor";
/** Where a user lands after signing in: clients their portal, staff their chosen start page (Settings). */
export const homeFor = (role: Role) => (role === "client" ? "/portal" : readPreferences().startPage);
