#!/usr/bin/env node
/**
 * 后续工作流：打包与部署
 *
 * 串联 build（数据聚合 + TypeScript 编译 + Vite 打包）→ deploy（OSS 增量上传），
 * 若打包失败则阻塞流程，不会执行部署。
 *
 * 用法:
 *   node scripts/release.mjs
 *   npm run release
 *   npm run release -- --dry-run   (仅预览 OSS 变更，不实际上传)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const DRY_RUN = process.argv.includes("--dry-run");

// ============================================================
// 工具函数
// ============================================================

/** 运行 Node 脚本并等待完成，stdio 继承以实时显示输出 */
function runNodeScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [scriptPath, ...args], {
      cwd: projectRoot,
      stdio: "inherit",
    });

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`脚本退出码: ${code}`));
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

/** 运行 npm script 并等待完成 */
function runNpmScript(scriptName, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const args = ["run", scriptName, ...extraArgs];
    const child = spawn("npm", args, {
      cwd: projectRoot,
      stdio: "inherit",
      shell: true,
    });

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm run ${scriptName} 退出码: ${code}`));
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  console.log("=".repeat(60));
  console.log("🚀 后续工作流：打包与部署");
  console.log("=".repeat(60));
  console.log();

  // ---- Step 1: 数据聚合 ----
  console.log("▶ 步骤 1/3: 聚合数据");
  console.log("-".repeat(40));

  try {
    await runNodeScript(path.join(__dirname, "build-data.mjs"));
    console.log();
  } catch (err) {
    console.error(`\n❌ 数据聚合失败: ${err.message}`);
    process.exit(1);
  }

  // ---- Step 2: Vite 生产构建 ----
  console.log("▶ 步骤 2/3: TypeScript 编译 + Vite 生产构建");
  console.log("-".repeat(40));

  try {
    // tsc -b && vite build
    console.log("🔨 正在编译 TypeScript...");

    await new Promise((resolve, reject) => {
      const child = spawn(
        path.join(projectRoot, "node_modules", ".bin", "tsc"),
        ["-b"],
        {
          cwd: projectRoot,
          stdio: "inherit",
        },
      );

      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`tsc 退出码: ${code}`));
      });

      child.on("error", (err) => {
        reject(err);
      });
    });

    console.log();
    console.log("📦 正在使用 Vite 打包...");

    await new Promise((resolve, reject) => {
      const child = spawn(
        path.join(projectRoot, "node_modules", ".bin", "vite"),
        ["build"],
        {
          cwd: projectRoot,
          stdio: "inherit",
        },
      );

      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`vite build 退出码: ${code}`));
      });

      child.on("error", (err) => {
        reject(err);
      });
    });

    console.log();
  } catch (err) {
    console.error(`\n❌ 生产构建失败: ${err.message}`);
    process.exit(1);
  }

  // ---- Step 3: OSS 部署 ----
  console.log("▶ 步骤 3/3: OSS 增量部署");
  console.log("-".repeat(40));

  const deployArgs = [];
  if (DRY_RUN) {
    deployArgs.push("--dry-run");
  }

  try {
    await runNodeScript(path.join(__dirname, "deploy-oss.mjs"), deployArgs);
  } catch (err) {
    console.error(`\n❌ OSS 部署失败: ${err.message}`);
    process.exit(1);
  }

  // ---- 完成 ----
  console.log();
  console.log("=".repeat(60));
  console.log("🎉 后续工作流执行完毕！");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("工作流出错:", err);
  process.exit(1);
});
