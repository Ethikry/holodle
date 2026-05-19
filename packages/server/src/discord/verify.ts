import { createPublicKey, verify as cryptoVerify } from "node:crypto";

// Discord signs interactions with Ed25519. The headers are:
//   X-Signature-Ed25519   — hex-encoded 64-byte signature
//   X-Signature-Timestamp — unix seconds string
// The message to verify is the literal raw body bytes prefixed by the
// timestamp. We must verify against the unparsed bytes — JSON.parse +
// JSON.stringify is not byte-stable and will fail the check.

// Cache the parsed KeyObject per hex string so we're not re-parsing on every
// request. The dev portal's "Public Key" is a 64-char hex string (raw Ed25519
// public key, 32 bytes). Node's KeyObject wants either PEM or a JWK; we wrap
// the raw bytes in the standard SubjectPublicKeyInfo prefix and feed it as DER.
const keyCache = new Map<string, ReturnType<typeof createPublicKey>>();

// DER prefix for an Ed25519 SubjectPublicKeyInfo:
//   30 2a                       SEQUENCE (42 bytes)
//     30 05                     SEQUENCE (5 bytes)
//       06 03 2b 65 70         OID 1.3.101.112 (Ed25519)
//     03 21 00                 BIT STRING (33 bytes, 0 unused bits)
//   <32 bytes of raw key follow>
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function loadKey(publicKeyHex: string): ReturnType<typeof createPublicKey> {
  const cached = keyCache.get(publicKeyHex);
  if (cached) return cached;
  const raw = Buffer.from(publicKeyHex, "hex");
  if (raw.length !== 32) {
    throw new Error(`Expected 32-byte Ed25519 public key, got ${raw.length} bytes`);
  }
  const spki = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
  const key = createPublicKey({ key: spki, format: "der", type: "spki" });
  keyCache.set(publicKeyHex, key);
  return key;
}

export interface VerifyInput {
  rawBody: Buffer | string;
  signature: string;
  timestamp: string;
  publicKey: string;
}

export function verifyInteractionSignature({
  rawBody,
  signature,
  timestamp,
  publicKey,
}: VerifyInput): boolean {
  if (!signature || !timestamp || !publicKey) return false;
  // Discord wants hex; bail early on non-hex input rather than throwing.
  if (!/^[0-9a-f]+$/i.test(signature) || signature.length !== 128) return false;
  let key: ReturnType<typeof createPublicKey>;
  try {
    key = loadKey(publicKey);
  } catch {
    return false;
  }
  const bodyBuf = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const message = Buffer.concat([Buffer.from(timestamp, "utf8"), bodyBuf]);
  const sigBuf = Buffer.from(signature, "hex");
  try {
    return cryptoVerify(null, message, key, sigBuf);
  } catch {
    return false;
  }
}
