import { describe, expect, it } from "vitest";
import { tosEndpointMatches } from "./tos-endpoint.js";
import { listAllUploadedPartsWith, listPartsSigningInput, parseListPartsBody, parseListPartsXml, providerObjectSigningInput } from "./tos.js";

describe("TOS endpoint validation", () => {
  it("accepts protocol and case differences", () => {
    expect(tosEndpointMatches("tos-cn-beijing.bytepluses.com.cn", "HTTPS://TOS-CN-BEIJING.BYTEPLUSES.COM.CN/")).toBe(true);
  });

  it("rejects a different TOS data plane", () => {
    expect(tosEndpointMatches("tos-cn-beijing.bytepluses.com.cn", "tos-cn-beijing.volces.com")).toBe(false);
  });

  it("rejects malformed or missing endpoints", () => {
    expect(tosEndpointMatches("", "tos-cn-beijing.bytepluses.com.cn")).toBe(false);
    expect(tosEndpointMatches("not a host", "tos-cn-beijing.bytepluses.com.cn")).toBe(false);
  });

  it("keeps provider media signatures free of response header overrides", () => {
    const input = providerObjectSigningInput("drama-firefly", "assets/ref.jpg", 7200);
    expect(input).toEqual({ bucket: "drama-firefly", key: "assets/ref.jpg", method: "GET", expires: 7200 });
    expect(input).not.toHaveProperty("response");
  });

  it("signs only the documented FNS ListParts query parameters", () => {
    expect(listPartsSigningInput("drama-firefly", "atlas/checkpoints/a.json.gz", "upload-1", 1000)).toEqual({
      bucket: "drama-firefly",
      key: "atlas/checkpoints/a.json.gz",
      method: "GET",
      expires: 300,
      query: { uploadId: "upload-1", "max-parts": "1000", "part-number-marker": "1000" },
    });
  });

  it("strictly parses and paginates the authoritative FNS ListParts JSON", async () => {
    const pages = [
      JSON.stringify({ IsTruncated: true, NextPartNumberMarker: 1, Parts: [{ PartNumber: 1, ETag: '"etag-1"' }] }),
      JSON.stringify({ IsTruncated: false, Parts: [{ PartNumber: 2, ETag: "etag-2" }] }),
    ];
    const signed: Array<number | undefined> = [];
    const result = await listAllUploadedPartsWith("key", "upload", {
      sign: (marker) => { signed.push(marker); return `https://tos.example/?page=${signed.length}`; },
      fetch: async () => ({ ok: true, status: 200, text: async () => pages.shift()! }),
    });
    expect(signed).toEqual([undefined, 1]);
    expect(result).toEqual([{ partNumber: 1, eTag: "etag-1" }, { partNumber: 2, eTag: "etag-2" }]);
    expect(parseListPartsBody(`<?xml version="1.0"?><ListPartsOutput><IsTruncated>false</IsTruncated><Part><PartNumber>3</PartNumber><ETag>etag-3</ETag></Part></ListPartsOutput>`))
      .toMatchObject({ parts: [{ partNumber: 3, eTag: "etag-3" }] });
    expect(() => parseListPartsXml("<ListPartsOutput><Part><PartNumber>0</PartNumber><ETag>x</ETag></Part></ListPartsOutput>"))
      .toThrow(/分片数据无效/);
    expect(parseListPartsBody(JSON.stringify({ IsTruncated: false }))).toEqual({ parts: [], isTruncated: false, nextMarker: undefined });
  });

  it("redacts pre-signed URLs from ListParts network and HTTP failures", async () => {
    const secretUrl = "https://tos.example/key?X-Tos-Signature=secret";
    await expect(listAllUploadedPartsWith("key", "upload", {
      sign: () => secretUrl,
      fetch: async () => { throw new TypeError(`fetch failed for ${secretUrl}`); },
    })).rejects.toMatchObject({ message: "TOS ListParts 网络请求失败", code: "TOS_LIST_PARTS_NETWORK_ERROR" });
    await expect(listAllUploadedPartsWith("key", "upload", {
      sign: () => secretUrl,
      fetch: async () => ({ ok: false, status: 403, headers: { get: () => "request-1" }, text: async () => JSON.stringify({ Code: "SignatureDoesNotMatch", Message: secretUrl }) }),
    })).rejects.toMatchObject({ message: "TOS ListParts 失败 (SignatureDoesNotMatch)", requestId: "request-1" });
    for (const unsafeCode of [secretUrl, "Bad\nCode", "A".repeat(129)]) {
      await expect(listAllUploadedPartsWith("key", "upload", {
        sign: () => secretUrl,
        fetch: async () => ({
          ok: false, status: 403,
          headers: { get: () => `request\n${secretUrl}` },
          text: async () => JSON.stringify({ Code: unsafeCode }),
        }),
      })).rejects.toMatchObject({ message: "TOS ListParts 失败 (HTTP_403)", code: "HTTP_403", requestId: undefined });
    }
  });

  it("rejects non-increasing pagination and duplicate parts across pages", async () => {
    const run = (pages: unknown[]) => listAllUploadedPartsWith("key", "upload", {
      sign: () => "https://tos.example/signed",
      fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(pages.shift()) }),
    });
    await expect(run([{ IsTruncated: true, NextPartNumberMarker: 2, Parts: [{ PartNumber: 1, ETag: "a" }] }, { IsTruncated: true, NextPartNumberMarker: 1, Parts: [{ PartNumber: 2, ETag: "b" }] }]))
      .rejects.toThrow(/游标未推进/);
    await expect(run([{ IsTruncated: true, NextPartNumberMarker: 1, Parts: [{ PartNumber: 1, ETag: "a" }] }, { IsTruncated: false, Parts: [{ PartNumber: 1, ETag: "a" }] }]))
      .rejects.toThrow(/重复分片/);
  });

});
