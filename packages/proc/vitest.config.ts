import { defineConfig } from "vitest/config";

// 固定测试范围为本包：vitest 5 无配置时会向上寻找根目录，误捡兄弟包的测试
export default defineConfig({
  test: {
    root: ".",
    include: ["test/**/*.test.ts"],
  },
});
