/**
 * 构建脚本：先清空 lib（避免旧编译产物残留），再跑 tsc。
 * 用法：node scripts/build.mjs
 */
import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
rmSync(join(root, 'lib'), { recursive: true, force: true });

const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const result = spawnSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.json')], {
  stdio: 'inherit',
  cwd: root,
});

if (result.status !== 0) {
  console.error('[build] tsc failed');
  process.exit(result.status ?? 1);
}
console.log('[build] ok -> lib/');
