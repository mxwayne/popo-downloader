import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";

await build({
  entryPoints: ["src/design/app.tsx"],
  bundle: true,
  format: "iife",
  target: ["chrome114"],
  outfile: "runtime/design.js",
  loader: { ".css": "text" },
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
});
if (!process.argv.includes("--build")) {
  const allowed =
    /^(design\.html|runtime\/design\.js|assets\/popo-logo(?:-\d+\.png|\.svg))$/;
  const server = createServer(async (req, res) => {
    const path =
      new URL(req.url || "/", "http://localhost").pathname.slice(1) ||
      "design.html";
    if (!allowed.test(path)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    try {
      const data = await readFile(resolve(path));
      res.writeHead(200, {
        "Content-Type":
          {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
          }[extname(path)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  server.listen(Number(process.env.POPO_DESIGN_PORT || 4178), "127.0.0.1", () =>
    console.log(
      `POPO Design: http://127.0.0.1:${server.address().port}/design.html`,
    ),
  );
}
