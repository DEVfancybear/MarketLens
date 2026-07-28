"use client";

import { postJson } from "@/services/api/client";
import { ApiError } from "@/services/api/errors";
import { currentIdToken } from "@/services/auth/firebaseAuth";

export type TradeAuthorizationOperation = "order" | "command";

interface CeremonyResponse {
  challengeId: string;
  options: {
    publicKey: Record<string, unknown>;
  };
}

interface AuthorizationResponse {
  token: string;
  expiresAtMs: number;
}

const pendingApprovalMessage =
  "Another trade approval is already in progress. Complete or cancel the open passkey prompt, then try again.";

let authorizationCeremonyInFlight = false;

const base64UrlToBytes = (value: string): Uint8Array<ArrayBuffer> => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
};

const bytesToBase64Url = (value: ArrayBuffer | ArrayBufferView): string => {
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

function credentialDescriptors(
  value: unknown,
): PublicKeyCredentialDescriptor[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((descriptor) => {
    const item = descriptor as {
      id: string;
      type?: PublicKeyCredentialType;
      transports?: AuthenticatorTransport[];
    };
    return {
      id: base64UrlToBytes(item.id),
      type: item.type ?? "public-key",
      transports: item.transports,
    };
  });
}

function creationOptions(
  source: Record<string, unknown>,
): PublicKeyCredentialCreationOptions {
  const user = source.user as PublicKeyCredentialUserEntity & { id: string };
  return {
    ...(source as unknown as PublicKeyCredentialCreationOptions),
    challenge: base64UrlToBytes(String(source.challenge)),
    user: { ...user, id: base64UrlToBytes(user.id) },
    excludeCredentials: credentialDescriptors(source.excludeCredentials),
  };
}

function requestOptions(
  source: Record<string, unknown>,
): PublicKeyCredentialRequestOptions {
  return {
    ...(source as unknown as PublicKeyCredentialRequestOptions),
    challenge: base64UrlToBytes(String(source.challenge)),
    allowCredentials: credentialDescriptors(source.allowCredentials),
  };
}

function credentialBase(credential: PublicKeyCredential) {
  return {
    id: credential.id,
    rawId: bytesToBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

function registrationCredential(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    ...credentialBase(credential),
    response: {
      clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      attestationObject: bytesToBase64Url(response.attestationObject),
      transports: response.getTransports?.() ?? [],
      authenticatorData: response.getAuthenticatorData
        ? bytesToBase64Url(response.getAuthenticatorData())
        : undefined,
      publicKey: response.getPublicKey
        ? bytesToBase64Url(response.getPublicKey() ?? new ArrayBuffer(0))
        : undefined,
      publicKeyAlgorithm: response.getPublicKeyAlgorithm?.(),
    },
  };
}

function assertionCredential(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    ...credentialBase(credential),
    response: {
      clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      authenticatorData: bytesToBase64Url(response.authenticatorData),
      signature: bytesToBase64Url(response.signature),
      userHandle: response.userHandle
        ? bytesToBase64Url(response.userHandle)
        : undefined,
    },
  };
}

function ensureWebAuthnAvailable(): void {
  if (
    typeof window === "undefined" ||
    !window.isSecureContext ||
    !window.PublicKeyCredential ||
    !navigator.credentials
  ) {
    throw new Error(
      "Passkey trade approval requires a secure HTTPS browser with WebAuthn support.",
    );
  }
}

async function enrollTradePasskey(): Promise<void> {
  ensureWebAuthnAvailable();
  const idToken = await currentIdToken();
  if (!idToken) {
    throw new Error("Sign in again before setting up a trade passkey.");
  }
  const ceremony = await postJson<CeremonyResponse>(
    "execution/passkeys/register/options",
    { idToken },
    { retry: { limit: 0 } },
  );
  const credential = await navigator.credentials.create({
    publicKey: creationOptions(ceremony.options.publicKey),
  });
  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error("Passkey setup was cancelled.");
  }
  await postJson(
    "execution/passkeys/register/verify",
    {
      challengeId: ceremony.challengeId,
      label: "Trade passkey",
      credential: registrationCredential(credential),
    },
    { retry: { limit: 0 } },
  );
}

async function beginAuthorization(
  operation: TradeAuthorizationOperation,
  payload: Record<string, unknown>,
): Promise<CeremonyResponse> {
  return postJson<CeremonyResponse>(
    "execution/authorizations/options",
    { operation, payload },
    { retry: { limit: 0 } },
  );
}

async function performTradeAuthorization(
  operation: TradeAuthorizationOperation,
  payload: Record<string, unknown>,
): Promise<string> {
  ensureWebAuthnAvailable();
  let ceremony: CeremonyResponse;
  try {
    ceremony = await beginAuthorization(operation, payload);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 428) throw error;
    await enrollTradePasskey();
    ceremony = await beginAuthorization(operation, payload);
  }

  const credential = await navigator.credentials.get({
    publicKey: requestOptions(ceremony.options.publicKey),
  });
  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error("Trade approval was cancelled.");
  }
  const authorization = await postJson<AuthorizationResponse>(
    "execution/authorizations/verify",
    {
      challengeId: ceremony.challengeId,
      operation,
      payload,
      credential: assertionCredential(credential),
    },
    { retry: { limit: 0 } },
  );
  if (!/^[A-Za-z0-9_-]{43}$/.test(authorization.token)) {
    throw new Error("The server returned an invalid trade authorization.");
  }
  return authorization.token;
}

function isPendingCredentialRequest(error: unknown): boolean {
  const candidate = error as { name?: unknown; message?: unknown } | null;
  const message =
    typeof candidate?.message === "string"
      ? candidate.message.toLowerCase()
      : "";
  return (
    candidate?.name === "InvalidStateError" ||
    message.includes("request is already pending")
  );
}

export async function authorizeTradeTransaction(
  operation: TradeAuthorizationOperation,
  payload: Record<string, unknown>,
): Promise<string> {
  if (authorizationCeremonyInFlight) {
    throw new Error(pendingApprovalMessage);
  }

  authorizationCeremonyInFlight = true;
  try {
    return await performTradeAuthorization(operation, payload);
  } catch (error) {
    if (isPendingCredentialRequest(error)) {
      throw new Error(pendingApprovalMessage);
    }
    throw error;
  } finally {
    authorizationCeremonyInFlight = false;
  }
}
