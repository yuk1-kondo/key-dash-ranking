import { cp, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist/site');
// Only replace this generated build directory, never the source site.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(root, 'site'), output, { recursive: true });
let html = await readFile(path.join(output, 'index.html'), 'utf8');
for (const filename of ['style.css', 'app.js', 'config.js']) {
  const content = await readFile(path.join(output, filename));
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
  const extension = path.extname(filename);
  const versioned = `${path.basename(filename, extension)}.${hash}${extension}`;
  await rename(path.join(output, filename), path.join(output, versioned));
  html = html.replaceAll(`"${filename}"`, `"${versioned}"`);
}
await writeFile(path.join(output, 'index.html'), html);
console.log('Built dist/site with content-hashed CSS and JavaScript.');
