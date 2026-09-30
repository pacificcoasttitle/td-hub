/**
 * READ-ONLY. What is actually in the worktrees, before anyone deletes any.
 *
 * The request was "prune them and remove the dead directories" on the
 * understanding that nearly all are prunable. THEY ARE NOT: `git worktree
 * list --porcelain` reports prunable for zero of them, meaning every directory
 * still exists and every registration is live. `git worktree prune` would
 * remove nothing, and `rm -rf` on the set would delete 60+ live checkouts.
 *
 * AGENTS.md records what that costs: on 2026-09-09 a cleanup destroyed eight
 * files belonging to another session's work, and the recovery was luck.
 * "Before any destructive git operation, list what it will affect and confirm
 * every path is yours."
 *
 * So this lists, and deletes nothing. For each worktree:
 *   - uncommitted?  tracked modifications or untracked files present
 *   - unmerged?     commits on its branch not reachable from origin/main
 *   - safe?         neither: nothing would be lost by removing it
 *
 *   node scripts/audit/worktree-survey.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const git = (args, cwd) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

const ROOT = process.cwd();
const porcelain = git(['worktree', 'list', '--porcelain'], ROOT);

const trees = [];
let cur = null;
for (const line of porcelain.split('\n')) {
  if (line.startsWith('worktree ')) {
    cur = { path: line.slice(9).trim(), branch: null, detached: false, prunable: false };
    trees.push(cur);
  } else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '').trim();
  else if (cur && line.startsWith('detached')) cur.detached = true;
  else if (cur && line.startsWith('prunable')) cur.prunable = true;
}

git(['fetch', '--quiet', 'origin'], ROOT);

const rows = [];
for (const t of trees) {
  if (!existsSync(t.path)) { rows.push({ ...t, missing: true }); continue; }
  const status = git(['status', '--porcelain'], t.path);
  const lines = status ? status.split('\n').filter(Boolean) : [];
  const modified = lines.filter((l) => !l.startsWith('??')).length;
  const untracked = lines.filter((l) => l.startsWith('??')).length;

  // Commits on this branch that origin/main does not already contain.
  const ahead = t.branch
    ? Number(git(['rev-list', '--count', `origin/main..${t.branch}`], t.path) || '0')
    : Number(git(['rev-list', '--count', 'origin/main..HEAD'], t.path) || '0');

  rows.push({ ...t, modified, untracked, ahead, missing: false });
}

const safe = rows.filter((r) => !r.missing && r.modified === 0 && r.untracked === 0 && r.ahead === 0);
const work = rows.filter((r) => !r.missing && (r.modified > 0 || r.ahead > 0));
const onlyUntracked = rows.filter((r) => !r.missing && r.modified === 0 && r.ahead === 0 && r.untracked > 0);

console.log(`\n${rows.length} worktrees. Prunable according to git: ${rows.filter((r) => r.prunable).length}\n`);
console.log(`  ${'category'.padEnd(34)} count`);
console.log(`  ${'safe to remove (clean + merged)'.padEnd(34)} ${safe.length}`);
console.log(`  ${'untracked files only'.padEnd(34)} ${onlyUntracked.length}`);
console.log(`  ${'HAS WORK (modified or unmerged)'.padEnd(34)} ${work.length}`);
console.log(`  ${'directory missing'.padEnd(34)} ${rows.filter((r) => r.missing).length}`);

console.log('\n── HAS WORK — do not remove these ──\n');
for (const r of work.sort((a, b) => b.ahead - a.ahead)) {
  console.log(`  ${r.path.split(/[\\/]/).pop().padEnd(42)} ${String(r.branch ?? '(detached)').padEnd(46)} +${r.ahead} commits, ${r.modified} modified, ${r.untracked} untracked`);
}

console.log('\n── SAFE: clean tree, nothing origin/main lacks ──\n');
for (const r of safe) {
  console.log(`  ${r.path.split(/[\\/]/).pop().padEnd(42)} ${r.branch ?? '(detached)'}`);
}

if (onlyUntracked.length > 0) {
  console.log('\n── untracked files only — look before removing ──\n');
  for (const r of onlyUntracked) {
    console.log(`  ${r.path.split(/[\\/]/).pop().padEnd(42)} ${String(r.branch ?? '(detached)').padEnd(46)} ${r.untracked} untracked`);
  }
}

console.log('\nNothing was deleted. Removing one is:');
console.log('  git worktree remove <path>            # refuses if the tree is dirty');
console.log('  git worktree remove --force <path>    # does not refuse — check first');
