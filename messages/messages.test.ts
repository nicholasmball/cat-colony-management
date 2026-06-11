import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import en from "./en.json" with { type: "json" };
import pt from "./pt.json" with { type: "json" };

// Top-level namespace keys, read from the RAW file text. JSON.parse (and the
// `import … with {type:"json"}` above) silently keeps only the LAST of any
// duplicate key, so a duplicate namespace shadows the earlier one without any
// parsed-object test noticing — exactly the bug that hid the Alert-thresholds
// page strings behind the notification-catalog `alerts` block. Prettier enforces
// 2-space indentation, so root keys are the `  "name":` lines.
function rawTopLevelKeys(file: string): string[] {
  const text = readFileSync(new URL(file, import.meta.url), "utf8");
  return [...text.matchAll(/^ {2}"([^"]+)":/gm)].map((m) => m[1]);
}

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

test("no duplicate top-level namespaces (a dupe silently shadows the earlier one)", () => {
  for (const file of ["./en.json", "./pt.json"]) {
    const keys = rawTopLevelKeys(file);
    const seen = new Set<string>();
    const dupes = [
      ...new Set(keys.filter((k) => seen.has(k) || (seen.add(k), false))),
    ];
    assert.deepEqual(
      dupes,
      [],
      `Duplicate top-level keys in ${file}: ${dupes.join(", ")}`,
    );
  }
});

test("alertSettings namespace has the keys the /app/alerts page renders", () => {
  // The page calls getTranslations("alertSettings") for exactly these. Guards
  // against the page referencing keys that don't resolve (which renders as raw
  // key text, e.g. "notSeenLabel", instead of throwing or failing the build).
  const required = [
    "title",
    "subtitle",
    "notSeenLabel",
    "notSeenHint",
    "unitDays",
    "repeatedLabel",
    "repeatedHint",
    "unitVisits",
    "missedLabel",
    "missedHint",
    "unitHours",
    "usingDefault",
    "savedToast",
    "saving",
    "save",
  ];
  for (const [name, cat] of [
    ["en", en],
    ["pt", pt],
  ] as const) {
    const ns = (cat as Record<string, Record<string, unknown>>).alertSettings;
    assert.ok(ns, `${name}.json is missing the alertSettings namespace`);
    const missing = required.filter((k) => !(k in ns));
    assert.deepEqual(
      missing,
      [],
      `${name}.alertSettings missing: ${missing.join(", ")}`,
    );
  }
});

test("help namespace has the keys the /app/help page renders", () => {
  // The page calls getTranslations("help") and resolves exactly these leaf
  // paths. Guards against a key the page references not resolving (which would
  // render as raw key text, e.g. "feeding.step1", instead of failing loudly).
  const required = [
    "title",
    "intro",
    "questions.heading",
    "questions.fed",
    "questions.seen",
    "questions.newMissing",
    "questions.problem",
    "feeding.heading",
    "feeding.intro",
    "feeding.step1",
    "feeding.step2",
    "feeding.step3",
    "feeding.step4",
    "feeding.step5",
    "feeding.offline",
    "newCat.heading",
    "newCat.body",
    "incident.heading",
    "incident.body",
    "incident.urgentLabel",
    "incident.urgent",
    "incident.notUrgentLabel",
    "incident.notUrgent",
    "roles.heading",
    "roles.adminLabel",
    "roles.admin",
    "roles.caretakerLabel",
    "roles.caretaker",
    "roles.feederLabel",
    "roles.feeder",
    "language.heading",
    "language.languageBody",
    "language.offlineBody",
  ];
  const resolve = (obj: Record<string, unknown>, path: string): unknown =>
    path.split(".").reduce<unknown>((acc, seg) => {
      if (acc && typeof acc === "object") {
        return (acc as Record<string, unknown>)[seg];
      }
      return undefined;
    }, obj);
  for (const [name, cat] of [
    ["en", en],
    ["pt", pt],
  ] as const) {
    const ns = (cat as Record<string, Record<string, unknown>>).help;
    assert.ok(ns, `${name}.json is missing the help namespace`);
    const missing = required.filter((k) => typeof resolve(ns, k) !== "string");
    assert.deepEqual(
      missing,
      [],
      `${name}.help missing: ${missing.join(", ")}`,
    );
  }
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
