/** CI defense in depth for Tauri/Minisign envelopes. Runtime uses the official Rust plugin.
 * Format: jedisct1/rust-minisign-verify (Ed25519/BLAKE2b + signed trusted comment).
 */
import { createHash, createPublicKey, verify } from 'node:crypto';
function base64(value: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Invalid signature encoding');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error('Invalid signature encoding');
  return bytes;
}
export function verifyUpdateSignature(
  bytes: Uint8Array,
  encodedSignature: string,
  encodedPublicKey: string,
  version: string,
) {
  const keyLines = base64(encodedPublicKey.trim()).toString('utf8').trim().split(/\r?\n/);
  const lines = base64(encodedSignature.trim()).toString('utf8').trim().split(/\r?\n/);
  if (
    keyLines.length !== 2 ||
    lines.length !== 4 ||
    !keyLines[0].startsWith('untrusted comment: ') ||
    !lines[0].startsWith('untrusted comment: ') ||
    !lines[2].startsWith('trusted comment: ')
  )
    throw new Error('Invalid Minisign envelope');
  const key = base64(keyLines[1]),
    packet = base64(lines[1]),
    global = base64(lines[3]);
  if (
    key.length !== 42 ||
    !['Ed', 'ED'].includes(key.subarray(0, 2).toString()) ||
    packet.length !== 74 ||
    packet.subarray(0, 2).toString() !== 'ED' ||
    global.length !== 64 ||
    !key.subarray(2, 10).equals(packet.subarray(2, 10))
  )
    throw new Error('Signature key or algorithm mismatch');
  const publicKey = createPublicKey({
    format: 'jwk',
    key: { kty: 'OKP', crv: 'Ed25519', x: key.subarray(10).toString('base64url') },
  });
  const signature = packet.subarray(10),
    comment = lines[2].slice('trusted comment: '.length);
  if (
    !verify(null, createHash('blake2b512').update(bytes).digest(), publicKey, signature) ||
    !verify(null, Buffer.concat([signature, Buffer.from(comment)]), publicKey, global)
  )
    throw new Error('Update signature rejected');
  const versions = [...comment.matchAll(/(?:^|\t)version:([^\t]+)/g)].map((m) => m[1]);
  if (versions.length !== 1 || versions[0] !== version)
    throw new Error('Signed update version mismatch');
}
