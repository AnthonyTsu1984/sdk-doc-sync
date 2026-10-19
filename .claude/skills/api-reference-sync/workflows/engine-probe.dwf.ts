/* zcode-workflow
description: 批 16 切片 5 引擎探针（一次性）：验证引擎接受 tracked 路径脚本、frontmatter args 在 path-run 下生效、node -e 与 files.read 两条世界通路可用。零写入、零 agent。
whenToUse: 批 16 release-sync 模板落地前的引擎验收；跑一次留档即可。
args:
  nonce:
    type: string
    description: 每 run 传新随机串；世界通路缓存键随它变化，防跨 run 重放
    required: false
    default: probe-nonce-missing
*/

const nonce = String(args.nonce ?? "");

phase("探针：frontmatter args 是否到达 path-run 脚本");
if (nonce === "" || nonce === "probe-nonce-missing") {
  return { status: "WORKFLOW_ARGS_LOST", note: "args 块未在 path-run 下生效——模板需回退案（拷贝实例+pin）前的引擎裁定" };
}

phase("探针：node -e 世界通路（cwd 应为仓库根）");
const echo = await world.run("node", [
  "-e",
  "const fs=require('node:fs');console.log(JSON.stringify({cwdHasClaudeDir:fs.existsSync('.claude/skills')}))",
  nonce,
]);

phase("探针：files.read 世界通路（读本探针文件自身）");
const self = await files.read(".claude/skills/api-reference-sync/workflows/engine-probe.dwf.ts");

return {
  status: "ok",
  nonce,
  argsOk: true,
  nodeEchoExit: echo.exitCode,
  nodeEchoStdout: echo.stdout.trim(),
  filesReadOk: self.includes("engine-probe"),
};
