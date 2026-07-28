import { access, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

const skillsRoot = '.agents/skills';
const failures = [];
const names = new Set();

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const entries = await readdir(skillsRoot, { withFileTypes: true });
const skillFolders = entries.filter((entry) => entry.isDirectory());

if (!skillFolders.length) {
  failures.push(`${skillsRoot}: no skill folders`);
}

for (const entry of skillFolders) {
  const skillFile = join(skillsRoot, entry.name, 'SKILL.md');
  if (!await exists(skillFile)) {
    failures.push(`${skillFile}: missing`);
    continue;
  }

  const text = await readFile(skillFile, 'utf8');
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    failures.push(`${skillFile}: invalid frontmatter`);
    continue;
  }

  const fields = match[1]
    .split('\n')
    .map((line) => line.match(/^([a-z]+):\s*(.+)$/))
    .filter(Boolean);
  const metadata = Object.fromEntries(fields.map((field) => [field[1], field[2]]));
  const keys = Object.keys(metadata).sort();

  if (keys.join(',') !== 'description,name') {
    failures.push(`${skillFile}: frontmatter must contain only name and description`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name ?? '')) {
    failures.push(`${skillFile}: invalid name`);
  }
  if (metadata.name !== entry.name) {
    failures.push(`${skillFile}: name must match folder`);
  }
  if (!metadata.description?.includes('Use when ')) {
    failures.push(`${skillFile}: description needs a Use when trigger`);
  }
  if ((metadata.description?.length ?? 0) > 1024) {
    failures.push(`${skillFile}: description exceeds 1024 characters`);
  }
  if (names.has(metadata.name)) {
    failures.push(`${skillFile}: duplicate name`);
  }
  names.add(metadata.name);

  for (const link of text.matchAll(/\[[^\]]+\]\(([^)]+\.md)\)/g)) {
    const target = resolve(dirname(skillFile), link[1]);
    if (!await exists(target)) {
      failures.push(`${skillFile}: missing link ${basename(target)}`);
    }
  }
}

if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Agent skill validation passed for ${skillFolders.length} skills.\n`);
}
