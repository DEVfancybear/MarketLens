import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const faviconPath = resolve(process.cwd(), "src/app/favicon.ico");
const expectedSizes = [16, 32, 48, 256];
const icoDirectorySize = 6;
const icoEntrySize = 16;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("MarketLens favicon contains the approved PNG-backed browser sizes", () => {
  assert.equal(
    existsSync(faviconPath),
    true,
    "src/app/favicon.ico must exist so Next.js can publish the project avatar",
  );

  const favicon = readFileSync(faviconPath);
  assert.ok(favicon.length > 1_024, "favicon must contain non-empty image payloads");
  assert.ok(favicon.length <= 512 * 1_024, "favicon must remain at or below 512 KiB");
  assert.equal(favicon.readUInt16LE(0), 0, "ICO reserved field must be zero");
  assert.equal(favicon.readUInt16LE(2), 1, "ICO type must identify an icon");
  assert.equal(favicon.readUInt16LE(4), expectedSizes.length);

  let expectedPayloadOffset = icoDirectorySize + expectedSizes.length * icoEntrySize;

  for (const [index, expectedSize] of expectedSizes.entries()) {
    const entryOffset = icoDirectorySize + index * icoEntrySize;
    const widthByte = favicon.readUInt8(entryOffset);
    const heightByte = favicon.readUInt8(entryOffset + 1);
    const width = widthByte === 0 ? 256 : widthByte;
    const height = heightByte === 0 ? 256 : heightByte;
    const payloadLength = favicon.readUInt32LE(entryOffset + 8);
    const payloadOffset = favicon.readUInt32LE(entryOffset + 12);

    assert.equal(width, expectedSize, `entry ${index} width`);
    assert.equal(height, expectedSize, `entry ${index} height`);
    assert.equal(favicon.readUInt8(entryOffset + 2), 0, `entry ${index} color count`);
    assert.equal(favicon.readUInt8(entryOffset + 3), 0, `entry ${index} reserved field`);
    assert.equal(favicon.readUInt16LE(entryOffset + 4), 1, `entry ${index} color planes`);
    assert.equal(favicon.readUInt16LE(entryOffset + 6), 32, `entry ${index} bit depth`);
    assert.ok(payloadLength > 24, `entry ${index} must contain a complete PNG header`);
    assert.equal(payloadOffset, expectedPayloadOffset, `entry ${index} payload offset`);
    assert.ok(
      payloadOffset + payloadLength <= favicon.length,
      `entry ${index} payload must stay inside the ICO file`,
    );

    const payload = favicon.subarray(payloadOffset, payloadOffset + payloadLength);
    assert.deepEqual(payload.subarray(0, pngSignature.length), pngSignature);
    assert.equal(payload.toString("ascii", 12, 16), "IHDR");
    assert.equal(payload.readUInt32BE(16), expectedSize, `entry ${index} PNG width`);
    assert.equal(payload.readUInt32BE(20), expectedSize, `entry ${index} PNG height`);
    assert.equal(payload.readUInt8(24), 8, `entry ${index} PNG bit depth`);
    assert.equal(payload.readUInt8(25), 6, `entry ${index} PNG color type must be RGBA`);

    expectedPayloadOffset += payloadLength;
  }

  assert.equal(expectedPayloadOffset, favicon.length, "ICO must not contain trailing bytes");
});
