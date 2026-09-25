import "./env";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import argon2 from "argon2";
import { timingSafeEqual } from "node:crypto";
import { accounts, db, eq, sql, users } from "./db";
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

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// A real hash to verify against when the email is unknown, so a miss costs the
// same time as a wrong password and response timing does not reveal accounts.
let decoyHash: Promise<string> | undefined;
function decoy(): Promise<string> {
  decoyHash ??= argon2.hash("distribution-decoy-password");
  return decoyHash;
}

/**
 * Email and password sign-in against the user's own argon2 hash.
 *
 * APP_PASSWORD is only a bootstrap: on a fresh install, before any owner
 * workspace exists, it creates the operator's workspace and first user. After
 * that it grants nothing, so it cannot be used to add users to the operator's
 * workspace or to reach anyone else's.
 */
export async function loginWithPassword(email: string, password: string): Promise<Session | null> {
  const address = normalizeEmail(email);
  const user = (await db.select().from(users).where(eq(users.email, address)).limit(1))[0];
  if (user) {
    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    return ok ? { userId: user.id, accountId: user.accountId, email: user.email } : null;
  }
  await argon2.verify(await decoy(), password).catch(() => false);

  const bootstrap = process.env.APP_PASSWORD;
  if (!bootstrap || !safeEqual(password, bootstrap)) return null;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('owner-bootstrap', 0))`);
    const owner = (await tx.select().from(accounts).where(eq(accounts.isOwner, true)).limit(1))[0];
    if (owner) return null;
    const account = (await tx.insert(accounts).values({ id: newId(), name: process.env.APP_ACCOUNT_NAME ?? "Owner", isOwner: true }).returning())[0]!;
    const created = (await tx.insert(users).values({ id: newId(), accountId: account.id, email: address, passwordHash: await argon2.hash(password) }).returning())[0]!;
    return { userId: created.id, accountId: created.accountId, email: created.email };
  });
}

export class SignupError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 409) {
    super(message);
    this.name = "SignupError";
  }
}

export function signupsOpen(): boolean {
  return (process.env.SIGNUPS ?? "open").toLowerCase() !== "closed";
}

/** Creates a new, separate workspace with its first user. */
export async function signUp(input: { email: string; password: string; workspace: string }): Promise<Session> {
  if (!signupsOpen()) throw new SignupError("Signing up is closed on this installation.", 403);
  const address = normalizeEmail(input.email);
  const passwordHash = await argon2.hash(input.password);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`signup:${address}`}, 0))`);
    const taken = (await tx.select({ id: users.id }).from(users).where(eq(users.email, address)).limit(1))[0];
    if (taken) throw new SignupError("An account with this email already exists. Sign in instead.", 409);
    const account = (await tx.insert(accounts).values({ id: newId(), name: input.workspace.trim(), isOwner: false }).returning())[0]!;
    const user = (await tx.insert(users).values({ id: newId(), accountId: account.id, email: address, passwordHash }).returning())[0]!;
    return { userId: user.id, accountId: user.accountId, email: user.email };
  });
}

export async function isOwnerAccount(accountId: string): Promise<boolean> {
  const row = (await db.select({ isOwner: accounts.isOwner }).from(accounts).where(eq(accounts.id, accountId)).limit(1))[0];
  return Boolean(row?.isOwner);
}
