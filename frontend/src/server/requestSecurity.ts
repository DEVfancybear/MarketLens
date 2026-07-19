import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { firebaseAdminConfigured, getFirebaseAdminAuth } from "./firebaseAdmin";

export const MAX_PUSH_TOKEN_LENGTH = 4096;
export const MAX_PUSH_ALERTS = 500;

/** Verify that a browser request belongs to a signed-in Firebase user. */
export async function requireFirebaseUser(req: NextRequest): Promise<string | null> {
  if (!firebaseAdminConfigured()) return null;
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (!token || token.length > 16_384) return null;
  try {
    const decoded = await getFirebaseAdminAuth().verifyIdToken(token, true);
    return decoded.uid || null;
  } catch {
    return null;
  }
}

export function validPushToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= MAX_PUSH_TOKEN_LENGTH;
}

/** Constant-time comparison for server-to-server route credentials. */
export function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
