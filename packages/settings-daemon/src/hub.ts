/**
 * hub.ts —— watch 事件中枢：防抖 + 内容哈希去重 + 自写环保护。
 *
 * 这是本任务最大的坑的解法：daemon 的 noctalia 桥自己写 colors.json，
 * 而 colors.json 同时是**事件源**（Noctalia 暗/亮切换会覆写它）——
 * 不加保护就是自我触发死循环。三道闸：
 *
 * 1. **目录级监听**：fs.watch(dirname)，按 basename 过滤——文件被 rename 原子替换
 *    （Noctalia/编辑器常见写法）时事件不丢；目录暂时不存在则轮询重试挂载。
 * 2. **防抖**：同一目标的连续事件合并（默认 250ms）后只读一次文件。
 * 3. **内容哈希**：读出内容算 sha256——
 *    a) 与上次**已见**哈希相同 → 内容没变，不上行；
 *    b) 与 daemon **自己刚写入**的哈希相同（recordSelfWrite 登记）→ 自写回声，不上行。
 * 另由 fsutil.writeIfChanged 保证：内容一致时根本不写（第一道闸，从源头减少事件）。
 *
 * 假阴性风险分析：daemon 写 X 后外部又写 Y → 哈希两者皆不同 → 正常上行（不误吞）。
 * 假阳性抑制：只有"内容完全等于我们自己写的/已见过的"才吞——吞掉的都无需处理。
 */
import { watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";

interface Target {
  dir: string;
  base: string;
  cb: (path: string) => void;
  watcher?: FSWatcher;
  retryTimer?: NodeJS.Timeout;
  debounceTimer?: NodeJS.Timeout;
  lastSeenHash: string | null;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export class WatchHub {
  private readonly targets = new Map<string, Target>();
  /** daemon 自己最近一次写入该文件的内容哈希（环保护登记簿） */
  private readonly selfHashes = new Map<string, string>();
  private stopped = false;

  constructor(private readonly opts: { debounceMs?: number; onDebug?: (msg: string) => void } = {}) {}

  /** 监听一个文件（目录级 + basename 过滤 + 防抖 + 哈希去重） */
  watch(target: string, cb: (path: string) => void): void {
    if (this.stopped) return;
    const t: Target = {
      dir: dirname(target),
      base: basename(target),
      cb,
      lastSeenHash: null,
    };
    this.targets.set(target, t);
    void this.attach(t, target);
  }

  /** daemon/CLI 刚写入某文件后登记哈希——同内容回声不再上行 */
  recordSelfWrite(target: string, content: string): void {
    const h = sha256(content);
    this.selfHashes.set(target, h);
    const t = this.targets.get(target);
    if (t) t.lastSeenHash = h;
  }

  /** 上次自写哈希（测试/观测用） */
  selfWriteHash(target: string): string | undefined {
    return this.selfHashes.get(target);
  }

  private debug(msg: string): void {
    this.opts.onDebug?.(msg);
  }

  private async attach(t: Target, target: string): Promise<void> {
    if (this.stopped) return;
    // 挂载即建立基线：当前内容算"已见"，不触发回调
    t.lastSeenHash = await hashFile(target);
    try {
      t.watcher = watch(t.dir, (_event, filename) => {
        // macOS FSEvents 偶尔不给 filename——无法过滤时按"可能命中"处理，
        // 多余事件会被哈希去重吞掉，不会误上行
        if (filename === undefined || filename === t.base) this.schedule(t, target);
      });
      t.watcher.on("error", () => this.reattach(t, target));
      this.debug(`watch 挂载: ${target}`);
    } catch {
      this.reattach(t, target);
    }
  }

  private reattach(t: Target, target: string): void {
    if (this.stopped) return;
    t.watcher?.close();
    t.watcher = undefined;
    t.retryTimer?.unref();
    t.retryTimer = setTimeout(() => void this.attach(t, target), 2000);
  }

  private schedule(t: Target, target: string): void {
    if (this.stopped) return;
    if (t.debounceTimer) clearTimeout(t.debounceTimer);
    t.debounceTimer = setTimeout(() => void this.fire(t, target), this.opts.debounceMs ?? 250);
  }

  private async fire(t: Target, target: string): Promise<void> {
    if (this.stopped) return;
    t.debounceTimer = undefined;
    const h = await hashFile(target);
    if (h === null) {
      // 文件暂时不存在（rename 中间态）——重置基线，不给回调
      t.lastSeenHash = null;
      return;
    }
    if (h === t.lastSeenHash) {
      this.debug(`去重跳过（内容未变）: ${target}`);
      return;
    }
    if (h === this.selfHashes.get(target)) {
      this.debug(`环保护跳过（自写回声）: ${target}`);
      t.lastSeenHash = h;
      return;
    }
    t.lastSeenHash = h;
    this.debug(`事件上行: ${target}`);
    t.cb(target);
  }

  async stopAll(): Promise<void> {
    this.stopped = true;
    for (const t of this.targets.values()) {
      if (t.debounceTimer) clearTimeout(t.debounceTimer);
      if (t.retryTimer) clearTimeout(t.retryTimer);
      t.watcher?.close();
    }
    this.targets.clear();
  }
}

async function hashFile(path: string): Promise<string | null> {
  try {
    return sha256(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}
