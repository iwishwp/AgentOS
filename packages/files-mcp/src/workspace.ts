import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export class FilesError extends Error {}

const MAX_READ_BYTES = 1024 * 1024;
const MAX_WALK_ENTRIES = 10_000;

/**
 * 沙箱化工作区（默认 ~/Agent，可用 AGENTOS_WORKSPACE 覆盖）。
 * 所有操作先经 resolveInside 做 realpath 越界检查：
 * ../ 逃逸、绝对路径、指向外部的符号链接都会被拒绝。
 */
export class Workspace {
  readonly root: string;

  constructor(root?: string) {
    const raw = root ?? process.env["AGENTOS_WORKSPACE"] ?? path.join(os.homedir(), "Agent");
    fs.mkdirSync(raw, { recursive: true });
    this.root = fs.realpathSync(raw);
  }

  listDir(rel = "."): string {
    const dir = this.resolveInside(rel);
    this.assertDir(dir, rel);
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    if (entries.length === 0) return "（空目录）";
    return entries
      .map((e) => (e.isDirectory() ? `d ${e.name}/` : e.isSymbolicLink() ? `l ${e.name}` : `- ${e.name}`))
      .join("\n");
  }

  readFile(rel: string, maxBytes = 64 * 1024): string {
    const file = this.resolveInside(rel);
    this.assertFile(file, rel);
    const size = fs.statSync(file).size;
    const cap = Math.min(maxBytes, MAX_READ_BYTES);
    if (size > cap) {
      throw new FilesError(`文件 ${size} 字节超出读取上限 ${cap}（可提高 maxBytes，上限 1MB）`);
    }
    return fs.readFileSync(file, "utf8");
  }

  writeFile(rel: string, content: string): number {
    const file = this.resolveInside(rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
    return Buffer.byteLength(content, "utf8");
  }

  createDir(rel: string): void {
    const dir = this.resolveInside(rel);
    fs.mkdirSync(dir, { recursive: true });
  }

  move(srcRel: string, dstRel: string): void {
    const src = this.resolveInside(srcRel);
    const dst = this.resolveInside(dstRel);
    if (!fs.existsSync(src)) throw new FilesError(`源不存在: ${srcRel}`);
    if (fs.existsSync(dst)) throw new FilesError(`目标已存在: ${dstRel}`);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
  }

  /** 删除 = 移入工作区内的 .trash/，可恢复。 */
  delete(rel: string): string {
    const file = this.resolveInside(rel);
    if (!fs.existsSync(file)) throw new FilesError(`不存在: ${rel}`);
    const trashDir = path.join(this.root, ".trash");
    fs.mkdirSync(trashDir, { recursive: true });
    const target = path.join(trashDir, `${Date.now()}-${path.basename(file)}`);
    fs.renameSync(file, target);
    return target;
  }

  /** 按名称子串递归查找（跳过 .trash），返回相对路径。 */
  findByName(pattern: string, limit = 200): string[] {
    const q = pattern.toLowerCase();
    const hits: string[] = [];
    let walked = 0;
    const stack: string[] = [this.root];
    while (stack.length > 0 && hits.length < limit && walked < MAX_WALK_ENTRIES) {
      const cur = stack.pop()!;
      walked++;
      for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
        if (e.name === ".trash") continue;
        const full = path.join(cur, e.name);
        if (e.name.toLowerCase().includes(q)) {
          hits.push(path.relative(this.root, full));
          if (hits.length >= limit) break;
        }
        if (e.isDirectory()) stack.push(full);
      }
    }
    return hits;
  }

  /** 核心安全检查：解析到 root 内部的真实路径，越界即拒。 */
  private resolveInside(rel: string): string {
    if (rel.trim() === "") throw new FilesError("路径不能为空");
    const abs = path.resolve(this.root, rel);
    let existing = abs;
    const tail: string[] = [];
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) throw new FilesError(`路径不可达: ${rel}`);
      tail.unshift(path.basename(existing));
      existing = parent;
    }
    const real = fs.realpathSync(existing);
    if (real !== this.root && !real.startsWith(this.root + path.sep)) {
      throw new FilesError(`路径越界，沙箱限制在 ${this.root}: ${rel}`);
    }
    return path.join(real, ...tail);
  }

  private assertDir(p: string, rel: string): void {
    if (!fs.statSync(p).isDirectory()) throw new FilesError(`不是目录: ${rel}`);
  }

  private assertFile(p: string, rel: string): void {
    if (!fs.statSync(p).isFile()) throw new FilesError(`不是文件: ${rel}`);
  }
}
