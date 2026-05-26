import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
  type CipherGCM,
  type DecipherGCM,
} from 'node:crypto';

// ---- On-disk format for an encrypted bytea blob ----------------------------
//
//   [0x01 version-marker] [1-byte key id] [12-byte IV] [16-byte auth tag] [N bytes ct]
//
// version-marker reserves room for future format changes (e.g. switching to
// XChaCha20-Poly1305). key id selects the symmetric key from the in-process
// keyring, so rotations are non-destructive: bump the active id and re-encrypt
// lazily on next write; old blobs stay decryptable because the old key stays
// in the map.
//
// Keys are loaded from env at startup:
//   APP_ENCRYPTION_KEYS='{"1":"<base64 of 32 random bytes>","2":"..."}'
//   APP_ENCRYPTION_ACTIVE_KEY_ID="1"

const VERSION_MARKER = 0x01;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = 2 + IV_LEN + TAG_LEN;

@Injectable()
export class CryptoService {
  private readonly keys: Map<number, Buffer>;
  private readonly activeKeyId: number;

  constructor() {
    const raw = process.env.APP_ENCRYPTION_KEYS;
    if (!raw) {
      throw new Error('APP_ENCRYPTION_KEYS is required (JSON map of {id: base64key})');
    }
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('APP_ENCRYPTION_KEYS must be valid JSON');
    }
    this.keys = new Map();
    for (const [idStr, b64] of Object.entries(parsed)) {
      const id = Number(idStr);
      if (!Number.isInteger(id) || id < 1 || id > 255) {
        throw new Error(`Invalid key id ${idStr}; must be integer 1..255`);
      }
      const key = Buffer.from(b64, 'base64');
      if (key.length !== 32) {
        throw new Error(`Key ${id} must be 32 bytes (base64-encoded); got ${key.length}`);
      }
      this.keys.set(id, key);
    }

    const activeStr = process.env.APP_ENCRYPTION_ACTIVE_KEY_ID;
    const active = Number(activeStr);
    if (!Number.isInteger(active) || !this.keys.has(active)) {
      throw new Error(
        `APP_ENCRYPTION_ACTIVE_KEY_ID must be an integer matching a configured key (have: ${[...this.keys.keys()].join(',')})`,
      );
    }
    this.activeKeyId = active;
  }

  /** Encrypts plaintext with the currently-active key. */
  encrypt(plaintext: string): Buffer {
    const key = this.keys.get(this.activeKeyId)!;
    const iv = randomBytes(IV_LEN);
    const cipher: CipherGCM = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const header = Buffer.alloc(HEADER_LEN);
    header.writeUInt8(VERSION_MARKER, 0);
    header.writeUInt8(this.activeKeyId, 1);
    iv.copy(header, 2);
    tag.copy(header, 2 + IV_LEN);
    return Buffer.concat([header, ct]);
  }

  /** Decrypts a blob produced by `encrypt`. Throws on tampering or missing key. */
  decrypt(input: Buffer | Uint8Array): string {
    // Prisma returns Uint8Array for bytea fields, not Buffer. Wrap so the
    // Buffer-only methods (.readUInt8, .subarray returning Buffer) work.
    const blob: Buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
    if (blob.length < HEADER_LEN) throw new Error('encrypted blob is too short');
    const version = blob.readUInt8(0);
    if (version !== VERSION_MARKER) {
      throw new Error(`Unsupported encryption format version: ${version}`);
    }
    const keyId = blob.readUInt8(1);
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Encryption key ${keyId} not loaded; cannot decrypt`);
    const iv = blob.subarray(2, 2 + IV_LEN);
    const tag = blob.subarray(2 + IV_LEN, 2 + IV_LEN + TAG_LEN);
    const ct = blob.subarray(HEADER_LEN);
    const decipher: DecipherGCM = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  /** For tests/diagnostics only — never log or expose this. */
  publicKeyIdForBlob(blob: Buffer): number | null {
    if (blob.length < 2) return null;
    if (blob.readUInt8(0) !== VERSION_MARKER) return null;
    return blob.readUInt8(1);
  }

  /** Constant-time eq for sensitive comparisons. */
  static safeEqual(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
