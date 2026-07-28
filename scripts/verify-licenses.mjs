import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
if (packageJson.license !== 'MIT') throw new Error('PROJECT_LICENSE_MUST_BE_MIT');

const licensePairs = [
  ['node_modules/@modelcontextprotocol/sdk/LICENSE', 'third_party/licenses/modelcontextprotocol-sdk-1.29.0-MIT.txt'],
  ['node_modules/chess.js/LICENSE', 'third_party/licenses/chess.js-1.4.0-BSD-2-Clause.txt'],
  ['node_modules/stockfish/Copying.txt', 'third_party/licenses/stockfish-18.0.8-GPL-3.0.txt'],
  ['node_modules/ws/LICENSE', 'third_party/licenses/ws-8.21.1-MIT.txt'],
  ['node_modules/zod/LICENSE', 'third_party/licenses/zod-4.4.3-MIT.txt'],
];

for (const [source, preserved] of licensePairs) {
  const [sourceText, preservedText] = await Promise.all([
    readFile(source),
    readFile(preserved),
  ]);
  if (!sourceText.equals(preservedText)) throw new Error(`LICENSE_TEXT_MISMATCH:${preserved}`);
}

const notices = await readFile('LICENSES.md', 'utf8');
for (const dependency of Object.keys(packageJson.dependencies)) {
  if (!notices.includes(`\`${dependency}\``)) throw new Error(`LICENSE_NOTICE_MISSING:${dependency}`);
}
if (!notices.includes('93c994592dcf3b4b21052ab925e9b534df9c0918')) {
  throw new Error('STOCKFISH_SOURCE_COMMIT_MISSING');
}
if (!notices.includes('ef9b6e9bd66de9869dc4715979ada23c6ab4fa96648025823a0a865f300667b2')) {
  throw new Error('STOCKFISH_SOURCE_SHA256_MISSING');
}

process.stdout.write('License verification passed.\n');
