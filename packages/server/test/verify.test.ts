import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyInteractionSignature } from "../src/discord/verify.js";

// Extract the raw 32-byte Ed25519 public key from a Node KeyObject by
// stripping the 12-byte SPKI prefix.
function rawPublicKeyHex(pub: ReturnType<typeof generateKeyPairSync>["publicKey"]): string {
  const spki = pub.export({ format: "der", type: "spki" });
  // SPKI for Ed25519 is exactly 44 bytes: 12-byte header + 32-byte key.
  return spki.subarray(spki.length - 32).toString("hex");
}

function makeSig(privateKey: Parameters<typeof sign>[2], timestamp: string, body: string): string {
  const message = Buffer.concat([Buffer.from(timestamp, "utf8"), Buffer.from(body, "utf8")]);
  return sign(null, message, privateKey).toString("hex");
}

describe("verifyInteractionSignature", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubHex = rawPublicKeyHex(publicKey);
  const timestamp = "1700000000";
  const body = JSON.stringify({ type: 1 });

  it("accepts a valid signature over the raw body", () => {
    const signature = makeSig(privateKey, timestamp, body);
    expect(
      verifyInteractionSignature({
        rawBody: Buffer.from(body, "utf8"),
        signature,
        timestamp,
        publicKey: pubHex,
      }),
    ).toBe(true);
  });

  it("rejects when the body has been tampered with", () => {
    const signature = makeSig(privateKey, timestamp, body);
    expect(
      verifyInteractionSignature({
        rawBody: Buffer.from(body + " ", "utf8"), // one extra byte
        signature,
        timestamp,
        publicKey: pubHex,
      }),
    ).toBe(false);
  });

  it("rejects when verified against a different public key", () => {
    const signature = makeSig(privateKey, timestamp, body);
    const { publicKey: otherPub } = generateKeyPairSync("ed25519");
    expect(
      verifyInteractionSignature({
        rawBody: Buffer.from(body, "utf8"),
        signature,
        timestamp,
        publicKey: rawPublicKeyHex(otherPub),
      }),
    ).toBe(false);
  });

  it("rejects non-hex / wrong-length signatures without throwing", () => {
    expect(
      verifyInteractionSignature({
        rawBody: Buffer.from(body, "utf8"),
        signature: "not-hex",
        timestamp,
        publicKey: pubHex,
      }),
    ).toBe(false);
  });

  it("rejects when timestamp doesn't match the signed timestamp", () => {
    const signature = makeSig(privateKey, timestamp, body);
    expect(
      verifyInteractionSignature({
        rawBody: Buffer.from(body, "utf8"),
        signature,
        timestamp: "1700000001",
        publicKey: pubHex,
      }),
    ).toBe(false);
  });
});
