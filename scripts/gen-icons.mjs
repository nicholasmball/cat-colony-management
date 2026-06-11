// Generate the PWA icon set from a high-res master (the SCoT cat+dog silhouette).
// The master is a transparent PNG; we composite it onto a solid cream canvas
// (#f7f4f2, the app background) so the black silhouette is visible on any home
// screen (iOS fills transparency with black otherwise), and pad the maskable
// variants into Android's safe zone. Re-run when the logo changes:
//   node scripts/gen-icons.mjs <path-to-master.png>
//
// Every output is flattened AND has its alpha channel stripped (removeAlpha):
// the PNGs are pure 3-channel RGB with no transparency anywhere, so no launcher
// or installer can render the residual alpha as a checkerboard / blank around
// the silhouette. The cream fills the full bleed; the silhouette sits on cream.
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
  // ...then lay it centered on a SOLID cream canvas, flatten any remaining
  // transparency onto cream, and DROP the alpha channel entirely so the file
  // is fully opaque RGB (no alpha plane left for a launcher to honour).
  await sharp({
    create: { width: size, height: size, channels: 4, background: cream },
  })
    .composite([{ input: fg, gravity: "center" }])
    .flatten({ background: cream })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(out);
}

// "any" variants: small margin, the silhouette fills most of the tile.
await gen(192, 0.86, "public/icon-192.png");
await gen(512, 0.86, "public/icon-512.png");
// "maskable" variants: ~19% safe-zone padding per side so Android's circle /
// squircle mask never clips the silhouette; cream bleeds to every edge.
await gen(192, 0.62, "public/icon-maskable-192.png");
await gen(512, 0.62, "public/icon-maskable-512.png");
// iOS home screen (no OS masking; matches the "any" framing).
await gen(180, 0.86, "public/apple-touch-icon.png");
console.log("icons generated");
