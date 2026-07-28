import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const roots = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'LICENSES.md',
  'llms.txt',
  'docs',
  '.github',
  '.agents',
];

async function filesAt(path) {
  const details = await stat(path);
  if (details.isFile()) return /\.(md|txt|ya?ml)$/.test(path) ? [path] : [];
  const files = [];
  for (const name of await readdir(path)) files.push(...await filesAt(join(path, name)));
  return files;
}

const failures = [];
for (const root of roots) {
  for (const file of await filesAt(root)) {
    let codeFence = false;
    const lines = (await readFile(file, 'utf8')).split('\n');
    for (const [index, rawLine] of lines.entries()) {
      const line = rawLine.trim();
      if (line.startsWith('```')) {
        codeFence = !codeFence;
        continue;
      }
      if (
        codeFence
        || !line
        || line.startsWith('#')
        || line.startsWith('|')
        || /^[-*]\s+`/.test(line)
      ) continue;
      const words = line
        .replace(/`[^`]*`/g, 'TERM')
        .replace(/<[^>]+>/g, 'LINK')
        .split(/\s+/)
        .filter(Boolean);
      if (words.length > 25) failures.push(`${file}:${index + 1}: ${words.length} words`);
    }
  }
}

if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Documentation sentence-length check passed.\n');
}
