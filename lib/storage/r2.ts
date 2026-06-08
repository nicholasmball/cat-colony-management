import "server-only";
import { AwsClient } from "aws4fetch";

// Cloudflare R2 (S3-compatible) storage. Server-only — the access key/secret
// never reach the browser; the browser only gets short-lived presigned URLs.
// Photos are kept in a PRIVATE bucket and read via presigned GET links.

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET;

export function r2Configured() {
  return Boolean(ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY && BUCKET);
}

function endpoint() {
  return `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
}

function client() {
  return new AwsClient({
    accessKeyId: ACCESS_KEY_ID!,
    secretAccessKey: SECRET_ACCESS_KEY!,
    service: "s3",
    region: "auto",
  });
}

// Keep slashes as path separators, encode each segment.
function encodeKey(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function objectUrl(key: string) {
  return `${endpoint()}/${BUCKET}/${encodeKey(key)}`;
}

// Presigned PUT the browser uses to upload a file directly to R2.
//
// contentType is BOUND into the signature (allHeaders pulls content-type into
// X-Amz-SignedHeaders), so the browser's PUT must send a matching Content-Type
// header or R2 rejects the upload — the client can't smuggle a different type.
//
// NOTE: a query-signed PUT cannot enforce a max upload size the way a presigned
// POST policy (Content-Length-range) can. We keep the client-side 25 MB check
// for UX; true server-side size enforcement would need a presigned POST policy
// (out of scope here).
export async function presignPut(
  key: string,
  contentType: string,
  expiresSeconds = 300,
) {
  const url = `${objectUrl(key)}?X-Amz-Expires=${expiresSeconds}`;
  const signed = await client().sign(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    aws: { signQuery: true, allHeaders: true },
  });
  return signed.url;
}

// Presigned GET used as an <img src> to display a private object.
export async function presignGet(key: string, expiresSeconds = 3600) {
  const url = `${objectUrl(key)}?X-Amz-Expires=${expiresSeconds}`;
  const signed = await client().sign(url, {
    method: "GET",
    aws: { signQuery: true },
  });
  return signed.url;
}

// Best-effort delete (e.g. when a photo is replaced or removed).
export async function deleteObject(key: string) {
  try {
    await client().fetch(objectUrl(key), { method: "DELETE" });
  } catch {
    // non-fatal: an orphaned object just sits in the bucket
  }
}
