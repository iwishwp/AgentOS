/**
 * fsutil.ts —— 幂等写（环保护的第一道闸）：
 * 期望内容与现有文件完全一致时**不写**（不触发 inotify、不动 mtime）。
 * daemon 与 CLI 并发跑 apply 时也靠它收敛：CLI 刚写过 → daemon 重算出相同内容 → 跳过写入。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** 返回是否真的写了 */
export async function writeIfChanged(path: string, content: string): Promise<boolean> {
  let current: string | null = null;
  try {
    current = await readFile(path, "utf8");
  } catch {
    current = null;
  }
  if (current === content) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return true;
}

export async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
