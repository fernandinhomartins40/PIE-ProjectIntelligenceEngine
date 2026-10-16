import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { rolldown } from "rolldown";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist/pie-web");
await mkdir(resolve(output, "assets"), { recursive: true });
const bundle = await rolldown({
  input: resolve(root, "apps/web/src/main.tsx"),
  platform: "browser",
  transform: {
    jsx: "react-jsx",
    define: { "process.env.NODE_ENV": '"production"' },
  },
});
try {
  await bundle.write({
    file: resolve(output, "assets/pie.js"),
    format: "esm",
    minify: true,
  });
} finally {
  await bundle.close();
}
await copyFile(
  resolve(root, "apps/web/src/styles.css"),
  resolve(output, "assets/pie.css"),
);
const html = await readFile(resolve(root, "apps/web/index.html"), "utf8");
await writeFile(resolve(output, "index.html"), html, "utf8");
console.log("PIE web built in dist/pie-web");
