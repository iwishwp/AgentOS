#!/usr/bin/env node
/** bin 入口：agentos-settings <daemon|apply|status|ipc> */
import { runCli } from "./cli.js";

runCli(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof Error ? e.stack : String(e));
    process.exit(1);
  });
