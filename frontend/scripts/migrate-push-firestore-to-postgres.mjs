import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";

const COLLECTION = "pushAlertDevices";
const PAGE_SIZE = 200;
const REQUEST_TIMEOUT_MS = 15_000;
const apply = process.argv.includes("--apply");

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function firebaseApp() {
  if (getApps().length) return getApps()[0];
  return initializeApp({
    credential: cert({
      projectId: requiredEnv("FIREBASE_PROJECT_ID"),
      clientEmail: requiredEnv("FIREBASE_CLIENT_EMAIL"),
      privateKey: requiredEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    }),
  });
}

function backendBase() {
  return requiredEnv("NEXT_PUBLIC_API_BASE_URL").replace(/\/+$/, "");
}

async function workerRequest(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${backendBase()}/api/v1/push/worker-devices${path}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-push-worker-secret": requiredEnv("PUSH_WORKER_SECRET"),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `${path} returned ${response.status}: ${payload.message ?? "unknown error"}`,
      );
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function migrationDevice(data, current) {
  return {
    ...current,
    token: data.token.trim(),
    ...(typeof data.deliveryToken === "string" && data.deliveryToken.trim()
      ? { deliveryToken: data.deliveryToken.trim() }
      : {}),
    notificationTimeZone:
      typeof data.notificationTimeZone === "string" &&
      data.notificationTimeZone.trim()
        ? data.notificationTimeZone.trim()
        : "UTC",
    alerts: Array.isArray(data.alerts) ? data.alerts : [],
    settingsPush: Boolean(data.settingsPush),
    settingsTelegram: Boolean(data.settingsTelegram),
    settingsDiscord: Boolean(data.settingsDiscord),
    lastPrices: isObject(data.lastPrices) ? data.lastPrices : {},
    alertState: isObject(data.alertState) ? data.alertState : {},
  };
}

async function importDocument(document) {
  const data = document.data();
  const token = typeof data.token === "string" ? data.token.trim() : "";
  const firebaseUid =
    typeof data.userId === "string" ? data.userId.trim() : "";
  if (!token || !firebaseUid) {
    throw new Error("document has no token or Firebase UID");
  }
  if (!apply) return;

  const ensured = await workerRequest("/ensure", { firebaseUid, token });
  if (!ensured.device || !Number.isFinite(ensured.device.version)) {
    throw new Error("backend returned an invalid ensured device");
  }
  const device = migrationDevice(data, ensured.device);
  await workerRequest("/put", {
    firebaseUid,
    expectedVersion: ensured.device.version,
    device,
  });
}

async function main() {
  requiredEnv("FIREBASE_PROJECT_ID");
  requiredEnv("FIREBASE_CLIENT_EMAIL");
  requiredEnv("FIREBASE_PRIVATE_KEY");
  if (apply) {
    requiredEnv("NEXT_PUBLIC_API_BASE_URL");
    requiredEnv("PUSH_WORKER_SECRET");
  }

  const firestore = getFirestore(firebaseApp());
  let cursor;
  let scanned = 0;
  let imported = 0;
  let failed = 0;

  for (;;) {
    let query = firestore
      .collection(COLLECTION)
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const document of snapshot.docs) {
      scanned += 1;
      try {
        await importDocument(document);
        imported += 1;
      } catch (error) {
        failed += 1;
        console.error(
          `[failed] ${document.id}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    cursor = snapshot.docs.at(-1);
    if (snapshot.size < PAGE_SIZE) break;
  }

  const verb = apply ? "imported" : "validated";
  console.log(
    `Firestore push migration ${apply ? "apply" : "dry-run"}: ${scanned} scanned, ${imported} ${verb}, ${failed} failed.`,
  );
  if (!apply) {
    console.log("No PostgreSQL writes were made. Re-run with --apply to import.");
  }
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    "Firestore push migration failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
