import { NextResponse, type NextRequest } from "next/server";
import {
  PushDeviceOwnershipError,
  registerPushDevice,
} from "@/server/pushAlertStore";
import { requireFirebaseUser, validPushToken } from "@/server/requestSecurity";
import {
  ServerOperationTimeoutError,
  withServerOperationTimeout,
} from "@/server/serverOperationTimeout";

export const runtime = "nodejs";
const PUSH_REGISTRATION_DEADLINE_MS = 8_000;

function serviceUnavailable(error: string) {
  return NextResponse.json(
    { error },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "1",
      },
    },
  );
}

function logRegistrationFailure(kind: string, error: unknown): void {
  const summary =
    error && typeof error === "object"
      ? {
          name:
            "name" in error && typeof error.name === "string"
              ? error.name
              : "Error",
          code:
            "code" in error &&
            (typeof error.code === "string" || typeof error.code === "number")
              ? error.code
              : "unknown",
        }
      : { name: typeof error, code: "unknown" };
  // Never log the FCM token, Firebase bearer token, or user id.
  console.error(`[push/register] ${kind}`, summary);
}

async function handlePost(req: NextRequest) {
  const userId = await requireFirebaseUser(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { token?: string } | null;
  if (!validPushToken(body?.token)) {
    return NextResponse.json({ error: "token is required." }, { status: 400 });
  }
  try {
    await registerPushDevice(body.token, userId);
  } catch (error) {
    if (error instanceof PushDeviceOwnershipError) {
      return NextResponse.json(
        { error: "Push token belongs to another user." },
        { status: 409 },
      );
    }
    logRegistrationFailure("storage unavailable", error);
    return serviceUnavailable(
      "Push registration storage is unavailable. Please try again.",
    );
  }
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  try {
    return await withServerOperationTimeout(
      "push registration",
      PUSH_REGISTRATION_DEADLINE_MS,
      () => handlePost(req),
    );
  } catch (error) {
    if (error instanceof ServerOperationTimeoutError) {
      logRegistrationFailure("deadline exceeded", error);
      return serviceUnavailable(
        "Push registration timed out while contacting Firebase. Please try again.",
      );
    }
    logRegistrationFailure("unexpected failure", error);
    return serviceUnavailable(
      "Push registration service is unavailable. Please try again.",
    );
  }
}
