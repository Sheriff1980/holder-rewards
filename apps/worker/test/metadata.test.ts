import { describe, expect, it } from "vitest";
import {
  metadataHasTrait,
  normalizeMetadataUrl,
  parseMetadataAttributes
} from "../src/metadata.js";

describe("NFT metadata traits", () => {
  it("parses common ERC-721 attribute shapes", () => {
    const attributes = parseMetadataAttributes({
      attributes: [
        { trait_type: "Background", value: "Gold" },
        { trait_type: "Level", value: 7 },
        { trait_type: "Animated", value: true }
      ]
    });

    expect(attributes).toEqual([
      { name: "Background", value: "Gold" },
      { name: "Level", value: "7" },
      { name: "Animated", value: "true" }
    ]);
  });

  it("supports the traits/name variant and ignores malformed entries", () => {
    expect(
      parseMetadataAttributes({
        traits: [
          { name: "Eyes", value: "Laser" },
          { name: "Missing value" },
          null
        ]
      })
    ).toEqual([{ name: "Eyes", value: "Laser" }]);
  });

  it("matches trait names and values exactly", () => {
    const attributes = [{ name: "Background", value: "Gold" }];
    expect(metadataHasTrait(attributes, "Background", "Gold")).toBe(true);
    expect(metadataHasTrait(attributes, "background", "Gold")).toBe(false);
    expect(metadataHasTrait(attributes, "Background", "gold")).toBe(false);
  });

  it("normalizes decentralized metadata URIs and rejects private hosts", () => {
    expect(normalizeMetadataUrl("ipfs://QmExample/path.json").toString()).toBe(
      "https://ipfs.io/ipfs/QmExample/path.json"
    );
    expect(normalizeMetadataUrl("ar://abcdefghijklmnopqrstuv").toString()).toBe(
      "https://arweave.net/abcdefghijklmnopqrstuv"
    );
    expect(() => normalizeMetadataUrl("https://127.0.0.1/metadata.json")).toThrow();
    expect(() => normalizeMetadataUrl("http://example.com/metadata.json")).toThrow();
  });
});
