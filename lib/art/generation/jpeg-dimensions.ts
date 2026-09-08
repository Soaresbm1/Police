/**
 * Reads real width/height out of JPEG bytes by scanning for the first
 * Start-Of-Frame marker (0xFFC0-0xFFCF, excluding the DHT/DAC markers
 * 0xFFC4/0xFFC8/0xFFCC which share the numeric range but aren't SOF
 * markers) — no image-decoding dependency needed for just the header.
 * Returns `null` for anything that isn't a well-formed JPEG rather than
 * throwing, since this is used to record metadata, not to gate whether
 * an asset counts as successfully generated.
 */
export function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null; // not a JPEG (SOI marker)

  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null; // malformed marker sequence

    const marker = bytes[offset + 1];
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }

    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2; // SOI/EOI carry no length field
      continue;
    }

    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}
