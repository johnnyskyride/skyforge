import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "freeze-out");
const jsPath = join(outDir, "assets", "app.js");
const cssPath = join(outDir, "assets", "style.css");

if (!existsSync(jsPath)) {
  throw new Error("freeze-out/assets/app.js missing — run vite freeze first");
}

let js = readFileSync(jsPath, "utf8");
let css = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "";

const jpgPath = join(root, "public", "crazy-88.jpg");
if (existsSync(jpgPath)) {
  const data = `data:image/jpeg;base64,${readFileSync(jpgPath).toString("base64")}`;
  js = js.replaceAll("/crazy-88.jpg", data);
  js = js.replaceAll("./crazy-88.jpg", data);
}

// HTML parsers close <script>/<style> at the first matching end tag.
// Never put the bundle through String.replace() as the replacement string —
// `$&` / `$`` in React's minified source would splice the document into itself.
js = js.replace(/<\/script/gi, "<\\/script");
css = css.replace(/<\/style/gi, "<\\/style");

const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SkyForge — SoSkyride</title>
    <meta name="theme-color" content="#1a1623" />
    <style>${css}</style>
  </head>
  <body class="bg-bg font-sans text-fg">
    <div id="root"></div>
    <script type="module">${js}</script>
  </body>
</html>
`;

function assertFrozen(doc) {
  const doctypes = doc.split("<!DOCTYPE").length - 1;
  if (doctypes !== 1) throw new Error(`expected 1 DOCTYPE, got ${doctypes}`);
  const scriptOpens = doc.match(/<script type="module">/g) ?? [];
  if (scriptOpens.length !== 1) {
    throw new Error(`expected 1 module script, got ${scriptOpens.length}`);
  }
  if (/src=["'][^"']*assets\/app\.js/.test(doc)) {
    throw new Error("leftover assets/app.js src");
  }
  if (doc.includes("/crazy-88.jpg") || doc.includes("crazy-88.jpg")) {
    throw new Error("leftover crazy-88.jpg URL");
  }
  const start = doc.indexOf('<script type="module">');
  const end = doc.lastIndexOf("</script>");
  if (start < 0 || end < 0 || end <= start) throw new Error("module script missing");
  const inner = doc.slice(start + '<script type="module">'.length, end);
  if (inner.includes("</script")) throw new Error("unescaped </script> in JS");
  if (!inner.includes("data:image/jpeg;base64,")) {
    throw new Error("crazy-88 data URI missing from JS");
  }
  if (!doc.includes("id=\"root\"")) throw new Error("missing #root");
}

assertFrozen(html);

const destPublic = join(root, "public", "SkyForge.html");
const destRoot = join(root, "SkyForge.html");
const destDesktop = join(root, "desktop", "dist", "index.html");
const destFace = join(root, "plugin", "src", "face.html");
mkdirSync(dirname(destDesktop), { recursive: true });
mkdirSync(dirname(destFace), { recursive: true });
writeFileSync(destPublic, html);
writeFileSync(destRoot, html);
writeFileSync(destDesktop, html);
writeFileSync(destFace, html);
console.log(`froze SkyForge.html (${(html.length / 1024).toFixed(0)} KB)`);
