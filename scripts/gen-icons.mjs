// Generate the PWA icon set from a high-res master (the SCoT cat+dog silhouette).
// The master is a transparent PNG; we composite it onto a solid cream canvas
// (#f7f4f2, the app background) so the black silhouette is visible on any home
// screen (iOS fills transparency with black otherwise), and pad the maskable
// variant into Android's safe zone. Re-run when the logo changes:
//   node scripts/gen-icons.mjs <path-to-master.png>
import sharp from "sharp";

const master = process.argv[2] ?? "/tmp/scot-icon-master.png";
const cream = { r: 247, g: 244, b: 242, alpha: 1 };
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

async function gen(size, scale, out) {
  const content = Math.round(size * scale);
  // Resize the silhouette (kept transparent) to the content box...
  const fg = await sharp(master)
    .resize(content, content, { fit: "contain", background: transparent })
    .png()
    .toBuffer();
  // ...then lay it centered on a SOLID cream canvas so every pixel is opaque.
  await sharp({
    create: { width: size, height: size, channels: 4, background: cream },
  })
    .composite([{ input: fg, gravity: "center" }])
    .flatten({ background: cream })
    .png({ compressionLevel: 9 })
    .toFile(out);
}

await gen(192, 0.86, "public/icon-192.png"); // any (small margin)
await gen(512, 0.86, "public/icon-512.png"); // any
await gen(512, 0.62, "public/icon-maskable-512.png"); // maskable (safe-zone padded)
await gen(180, 0.86, "public/apple-touch-icon.png"); // iOS home screen
console.log("icons generated");
