import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { deleteSession, findSession, findUserById, insertSession, deleteExpiredSessions } from "./db";

const COOKIE_NAME = "abyss_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export async function createSessionToken(userId: number): Promise<string> {
  deleteExpiredSessions();
  const token = randomBytes(32).toString("hex");
  insertSession(token, userId, Date.now() + SESSION_TTL_MS);
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return token;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    deleteSession(token);
    store.delete(COOKIE_NAME);
  }
}

export async function getCurrentUser(): Promise<{ id: number; username: string } | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = findSession(token);
  if (!session || session.expires_at < Date.now()) {
    if (session) deleteSession(token);
    return null;
  }
  const user = findUserById(session.user_id);
  return user ? { id: user.id, username: user.username } : null;
}
