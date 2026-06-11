// Generate the PWA icon set from the SCoT logo (public/scot-logo.png).
// The logo is the cat+dog mark + "Street Cats of Tavira" wordmark on white.
// We extract JUST the mark (top band, above the wordmark), recolour it
// (white -> cream #f7f4f2, black -> near-black) so the silhouette sits on the
// app's cream background, and emit fully-opaque RGB PNGs (no alpha channel, so
// no launcher renders a transparency checkerboard). Re-run when the logo
// changes:  node scripts/gen-icons.mjs [path-to-logo.png]
import sharp from "sharp";

const master = process.argv[2] ?? "public/scot-logo.png";
const cream = { r: 247, g: 244, b: 242 };
const DARK = 25;

// Mark extraction: crop the top band, flatten to opaque white, linear-map
// (white->cream, black->dark, antialiased edges blend), trim to a tight bbox.
const meta = await sharp(master).metadata();
const a = [
  (cream.r - DARK) / 255,
  (cream.g - DARK) / 255,
  (cream.b - DARK) / 255,
];
const recoloured = await sharp(master)
  .extract({
    left: 0,
    top: 0,
    width: meta.width,
    height: Math.round(meta.height * 0.58),
  })
  .flatten({ background: { r: 255, g: 255, b: 255 } })
  .linear(a, [DARK, DARK, DARK])
  .png()
  .toBuffer();
const mark = await sharp(recoloured).trim({ threshold: 10 }).toBuffer();

async function gen(size, scale, out) {
  const content = Math.round(size * scale);
  const fg = await sharp(mark)
    .resize(content, content, { fit: "contain", background: cream })
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 3, background: cream },
  })
    .composite([{ input: fg, gravity: "center" }])
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(out);
}

await gen(192, 0.78, "public/icon-192.png"); // "any" variants
await gen(512, 0.78, "public/icon-512.png");
await gen(192, 0.6, "public/icon-maskable-192.png"); // maskable: safe-zone padding
await gen(512, 0.6, "public/icon-maskable-512.png");
await gen(180, 0.78, "public/apple-touch-icon.png"); // iOS home screen
console.log("icons generated from", master);
