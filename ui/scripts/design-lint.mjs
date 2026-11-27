#!/usr/bin/env node
// Design.md, enforced: fails the build on what the design system forbids in
// the UI's templates and component styles. See CLAUDE.md "Design system".
//
//   node scripts/design-lint.mjs        (runs before `npm run build`)
//
// A line may opt out with a trailing `design-lint-ignore` comment and a reason.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../src/app/', import.meta.url).pathname;

/** [rule id, pattern, what to do instead] */
const RULES = [
  ['no-shadow', /(?<![\w-])(?:[a-z-]+:)*shadow-(?:xs|sm|md|lg|xl|2xl|theme-(?:xs|sm|md|lg|xl))(?![\w-])/, 'flat: separate with a band, white space or a hairline border'],
  // A blurred box-shadow is elevation; zero-blur hairlines and inset indicators are fine.
  ['no-box-shadow-css', /box-shadow:\s*(?!\s|none|inset)-?[\d.]+(?:px)?\s+-?[\d.]+(?:px)?\s+[1-9]|filter:\s*drop-shadow/, 'flat: no blurred shadows in component CSS (hairlines and inset indicators only)'],
  ['no-letter-spacing', /(?<![\w-])(?:[a-z-]+:)*tracking-\[[^\]]+\]|letter-spacing:\s*(?!0)[\d.-]/, 'no letter-spacing'],
  ['no-pill', /class="[^"]*\brounded-full\b[^"]*\bpx-\d[^"]*"|class="[^"]*\bpx-\d[^"]*\brounded-full\b[^"]*"/, 'no pills: text gets rounded-sm (badges) or rounded-md (controls)'],
  ['no-legacy-brand', /#465fff|rgba\(70,\s*95,\s*255/i, 'the brand blue is brand-500 (#0057d2)'],
  ['no-second-font', /font-family:\s*(?!inherit|var\(--)/, 'one family: Inter Variable via the theme'],
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(html|ts|css)$/.test(name) && !name.endsWith('.spec.ts')) yield path;
  }
}

const problems = [];
for (const file of files(root)) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (line.includes('design-lint-ignore')) return;
    for (const [id, pattern, advice] of RULES) {
      if (pattern.test(line)) problems.push(`${relative(process.cwd(), file)}:${i + 1}  ${id} — ${advice}\n    ${line.trim().slice(0, 160)}`);
    }
  });
}

if (problems.length) {
  console.error(`Design.md violations (${problems.length}):\n\n${problems.join('\n')}\n`);
  process.exit(1);
}
console.log('design-lint: no Design.md violations');
