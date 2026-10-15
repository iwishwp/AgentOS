#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { createCanvasServer } from "./server.js";

const root = process.env["AGENTOS_CANVAS_ROOT"] ?? path.join(os.homedir(), "Agent", "canvas");
const port = Number(process.env["AGENTOS_CANVAS_PORT"] ?? 7788);

createCanvasServer(root).listen(port, "127.0.0.1", () => {
  console.log(`agentos-canvas: http://127.0.0.1:${port} ← ${root}`);
});
