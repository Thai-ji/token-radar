// token-radar-01 的跑批入口：吃进密封快照，产出一个完整 /output。
//
// 这个文件只做三件事：解析参数、调 lib/model.ts 里的模型、把结果搬到输出目录并拒收不合格的板子。
// 评分逻辑全部在 lib/model.ts；这里不动任何一行分数。
//
// 用法：node main.ts --input <snapshot.json 或其所在目录> [--output <目录>]
// 容器外用 MAKEFUN_OUTPUT_DIR 代替 /output，本地干跑：
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as radar from './lib/model.ts';
import * as boardkit from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

/** dossier 的尺寸上限（reference/gate.json 原数）：文本 64K，截图 4 张各 512K，dashboard 400 个文件 4MiB。 */
const CAPS = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};

/** 从命令行取 --label value 或 --label=value 两种写法的值。 */
function flag(label: string): string | undefined {
  const split = process.argv.indexOf(`--${label}`);
  if (split >= 0 && split + 1 < process.argv.length) return process.argv[split + 1];
  const glued = process.argv.find((token) => token.startsWith(`--${label}=`));
  return glued?.slice(label.length + 3);
}

/** 报错退出：一行错误，退出码 1。 */
function die(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = flag('input') ?? '/input';
const snapshotPath = inputArg.endsWith('.json') ? inputArg : path.join(inputArg, 'snapshot.json');
if (!fs.existsSync(snapshotPath)) die(`no snapshot found at ${snapshotPath}; pass --input <snapshot.json|folder>`);
const outDir = flag('output') ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const snapshot = radar.parseSnapshot(fs.readFileSync(snapshotPath, 'utf8'));
const { board, radar: view } = radar.buildRadar(snapshot);
const problem = radar.boardIssue(board, snapshot);
if (problem !== null) die(`the model produced a board the gate rejects: ${problem}`);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
fs.writeFileSync(path.join(outDir, 'data.js'), radar.dataScript(view));

/** 把一个目录下的普通文件复制到 toDir（点开头的名字跳过），返回复制了哪些。 */
function copyAssets(fromDir: string, toDir: string): string[] {
  if (!fs.existsSync(fromDir)) return [];
  fs.mkdirSync(toDir, { recursive: true });
  const taken: string[] = [];
  for (const item of fs.readdirSync(fromDir)) {
    if (item.startsWith('.')) continue;
    const full = path.join(fromDir, item);
    if (!fs.statSync(full).isFile()) continue;
    fs.copyFileSync(full, path.join(toDir, item));
    taken.push(item);
  }
  return taken;
}

copyAssets(path.join(repoRoot, 'dashboard'), path.join(outDir, 'dashboard'));
const captures = copyAssets(path.join(repoRoot, 'screenshots'), path.join(outDir, 'screenshots'));
if (captures.length < 3) {
  die(`screenshots/ carries only ${captures.length} file${captures.length === 1 ? '' : 's'}: the board, a detail view and a filtered view are required`);
}
for (const item of captures) {
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(item)) {
    die(`screenshots/${item}: allowed names are 1 to 128 characters of letters, digits and . _ -`);
  }
}

// dossier 最后写：评分器会从整个 /output 重建它并逐字节比对。
fs.writeFileSync(path.join(outDir, 'dossier.json'), boardkit.buildDossier(outDir, CAPS));

process.stdout.write(
  `token radar: read ${snapshot.protocols.length} protocols (${snapshot.watchlist.length} watched), ranked ${board.length} rows, ${view.early_size} early and ${view.live_size} live set aside\n` +
    `token radar: board.json, data.js, dashboard/, screenshots/ (${captures.length} images) and dossier.json are in ${outDir}\n`,
);
