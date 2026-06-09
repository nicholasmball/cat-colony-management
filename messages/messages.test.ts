import { test } from "node:test";
import assert from "node:assert/strict";
import en from "./en.json" with { type: "json" };
import pt from "./pt.json" with { type: "json" };

// Collect every leaf key path ("nav.dashboard", "feed.fed", …) from a nested
// messages object. ICU placeholders live inside the string values, so leaves are
// strings; nested objects are namespaces.
function keyPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...keyPaths(v as Record<string, unknown>, path));
    } else {
      out.push(path);
    }
  }
  return out.sort();
}

test("en.json and pt.json have identical key sets (no drift)", () => {
  const enKeys = keyPaths(en as Record<string, unknown>);
  const ptKeys = keyPaths(pt as Record<string, unknown>);

  const missingInPt = enKeys.filter((k) => !ptKeys.includes(k));
  const missingInEn = ptKeys.filter((k) => !enKeys.includes(k));

  assert.deepEqual(
    missingInPt,
    [],
    `Keys present in en.json but missing in pt.json: ${missingInPt.join(", ")}`,
  );
  assert.deepEqual(
    missingInEn,
    [],
    `Keys present in pt.json but missing in en.json: ${missingInEn.join(", ")}`,
  );
});

test("no message value is left blank in either locale", () => {
  for (const [name, cat] of [
    ["en", en],
    ["pt", pt],
  ] as const) {
    const walk = (obj: Record<string, unknown>, prefix = "") => {
      for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === "object") {
          walk(v as Record<string, unknown>, path);
        } else {
          assert.ok(
            typeof v === "string" && v.trim().length > 0,
            `Empty message at ${name}:${path}`,
          );
        }
      }
    };
    walk(cat as Record<string, unknown>);
  }
});
