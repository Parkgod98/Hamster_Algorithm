import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
export async function hashSecret(value: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = await derive(value, salt, 64) as Buffer;
  return `s1$${salt}$${hash.toString("hex")}`;
}

export async function verifySecret(value: string, encoded: string) {
  const [version, salt, hash] = encoded.split("$");
  if (version !== "s1" || !salt || !hash || !/^[a-f0-9]{128}$/.test(hash)) return false;
  const actual = await derive(value, salt, 64) as Buffer;
  return timingSafeEqual(actual, Buffer.from(hash, "hex"));
}

export function newAccountToken() { return `hs1_${randomBytes(32).toString("hex")}`; }
export function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }

/** Stable provisioning ID for retries between GoTrue and the app transaction. */
export function accountIdentityId(login: string) {
  const bytes = createHash("sha256").update(`hamster.account.v1\0${login}`).digest().subarray(0,16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-");
}
