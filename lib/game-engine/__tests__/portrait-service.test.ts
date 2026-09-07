import { describe, expect, it } from "vitest";
import { DeterministicAvatarService } from "../portraits/portrait-service";

describe("DeterministicAvatarService", () => {
  const service = new DeterministicAvatarService();

  it("is deterministic: same seed and name always produce the same portrait", () => {
    const a = service.getPortraitUrl("person_abc123", "Julie Dupont");
    const b = service.getPortraitUrl("person_abc123", "Julie Dupont");
    expect(a).toBe(b);
  });

  it("produces different portraits for different seeds", () => {
    const a = service.getPortraitUrl("person_abc123", "Julie Dupont");
    const b = service.getPortraitUrl("person_xyz789", "Marc Weber");
    expect(a).not.toBe(b);
  });

  it("returns a renderable data URI", () => {
    const url = service.getPortraitUrl("seed", "Ana Lee");
    expect(url).toMatch(/^data:image\/svg\+xml,/);
  });
});
