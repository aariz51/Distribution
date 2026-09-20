import "./env";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import argon2 from "argon2";
import { timingSafeEqual } from "node:crypto";
import { accounts, db, eq, users } from "./db";
import { newId } from "@distribution/core";
import { requireEnv } from "./env";

const COOKIE = "dist_session";
const TTL_SECONDS = 60 * 60 * 24 * 14;

export interface Session {
  userId: string;
  accountId: string;
  email: string;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(requireEnv("APP_SECRET"));
}

export async function createSessionCookie(session: Session): Promise<void> {
  const jwt = await new SignJWT({ accountId: session.accountId, email: session.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, jwt, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: TTL_SECONDS });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub || typeof payload.accountId !== "string") return null;
    return { userId: payload.sub, accountId: payload.accountId, email: String(payload.email ?? "") };
  } catch {
    return null;
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new UnauthorizedError();
  return s;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Phase 1 single-tenant login: the password is APP_PASSWORD. On first login the
 * account + user rows are created (with an argon2 hash) so Phase 6 multi-user
 * can switch to per-user passwords without a data migration.
 */
export async function loginWithPassword(email: string, password: string): Promise<Session | null> {
  const expected = requireEnv("APP_PASSWORD");
  if (!safeEqual(password, expected)) return null;
  const accountName = process.env.APP_ACCOUNT_NAME ?? "Founder";
  let account = (await db.select().from(accounts).where(eq(accounts.name, accountName)).limit(1))[0];
  if (!account) account = (await db.insert(accounts).values({ id: newId(), name: accountName }).returning())[0]!;
  let user = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  if (!user) {
    user = (
      await db
        .insert(users)
        .values({ id: newId(), accountId: account.id, email, passwordHash: await argon2.hash(password) })
        .returning()
    )[0]!;
  }
  return { userId: user.id, accountId: user.accountId, email: user.email };
}
