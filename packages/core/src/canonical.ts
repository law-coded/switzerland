import { createHash } from "node:crypto";

/**
 * RFC 8785 (JSON Canonicalization Scheme, JCS) deterministic serializer.
 * Guarantees byte-identical hashing across runtimes and platforms.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`);
    return `{${entries.join(",")}}`;
  }
  return "null";
}

export function computeCanonicalHash(value: unknown): string {
  const canonical = canonicalizeJson(value);
  const hex = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `sha256:${hex}`;
}
