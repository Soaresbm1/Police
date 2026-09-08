import { describe, expect, it } from "vitest";
import { readJpegDimensions } from "../jpeg-dimensions";

/** Builds a minimal, syntactically valid JPEG byte sequence (SOI + one
 * throwaway APP0 segment + a baseline SOF0 with the given dimensions) —
 * enough for the parser, not a real decodable image. */
function makeMinimalJpeg(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0)]; // length 16 -> 14 payload bytes
  const sof0 = [
    0xff,
    0xc0,
    0x00,
    0x11, // length 17
    0x08, // precision
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03, // 3 components
    ...Array(9).fill(0),
  ];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0]);
}

describe("readJpegDimensions", () => {
  it("reads width/height from a well-formed JPEG", () => {
    expect(readJpegDimensions(makeMinimalJpeg(1024, 768))).toEqual({ width: 1024, height: 768 });
  });

  it("reads non-square dimensions correctly (width and height not swapped)", () => {
    expect(readJpegDimensions(makeMinimalJpeg(64, 32))).toEqual({ width: 64, height: 32 });
  });

  it("returns null for bytes that aren't a JPEG at all", () => {
    expect(readJpegDimensions(new TextEncoder().encode("not a jpeg"))).toBeNull();
  });

  it("returns null for a truncated/empty buffer", () => {
    expect(readJpegDimensions(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  it("skips over non-SOF marker segments (e.g. APP0/EXIF) to find the real SOF", () => {
    const jpeg = makeMinimalJpeg(800, 600);
    expect(readJpegDimensions(jpeg)?.width).toBe(800);
  });
});
