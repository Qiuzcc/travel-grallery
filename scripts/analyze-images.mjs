#!/usr/bin/env node
/**
 * 图片分析封装模块
 *
 * 通过 child_process.spawn 调用 Python 图片分析脚本（main.py），
 * 解析 stdout JSON 结果返回给调用方。
 *
 * 用法示例:
 *   import { analyzeImages } from "./scripts/analyze-images.mjs";
 *
 *   const results = await analyzeImages({
 *     basePath: "/Users/timegogo/projects/gallery/public/gallery",
 *     dirs: ["*"],
 *     apiKey: process.env.MOONSHOT_API_KEY,
 *     onProgress: (line) => console.log("[分析]", line),
 *   });
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

/** image-analysis 项目根目录 */
const IMAGE_ANALYSIS_DIR = path.resolve(
  projectRoot,
  "..",
  "image-analysis",
);

/** 默认 Python 脚本路径 */
const DEFAULT_PYTHON_SCRIPT = path.join(IMAGE_ANALYSIS_DIR, "main.py");

/** 默认 Python 解释器路径（优先使用 venv 中的 Python） */
const DEFAULT_PYTHON_PATH = (() => {
  const venvPython = path.join(IMAGE_ANALYSIS_DIR, ".venv", "bin", "python");
  if (fs.existsSync(venvPython)) return venvPython;
  return "python3";
})();

/**
 * 加载项目 .env 文件中的环境变量（简易实现，不依赖 dotenv 包）
 */
function loadEnv(envDir = projectRoot) {
  const envPath = path.join(envDir, ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

/**
 * 调用 Python 图片分析脚本
 *
 * @param {Object} options
 * @param {string} options.basePath - 图片目录的公共根路径
 * @param {string[]} options.dirs - 子目录后缀数组，如 ["/北京市","/上海市"]，或 ["*"] 自动发现所有子目录
 * @param {string} [options.apiKey] - Moonshot API Key，未传则从环境变量 MOONSHOT_API_KEY 读取
 * @param {string} [options.pythonPath] - Python 解释器路径，默认自动检测 .venv
 * @param {string} [options.pythonScript] - main.py 路径，默认 ../image-analysis/main.py
 * @param {number} [options.timeout] - 超时毫秒数，默认 600000 (10 分钟)
 * @param {(line: string) => void} [options.onProgress] - stderr 进度回调
 * @returns {Promise<Record<string, Array<{file_name: string, title: string, description: string}>>>}
 */
export function analyzeImages(options = {}) {
  const {
    basePath,
    dirs,
    apiKey,
    pythonPath = DEFAULT_PYTHON_PATH,
    pythonScript = DEFAULT_PYTHON_SCRIPT,
    timeout = 600_000, // 10 分钟
    onProgress,
  } = options;

  // 参数校验
  if (!basePath) {
    return Promise.reject(new Error("缺少必填参数: basePath"));
  }
  if (!dirs || !Array.isArray(dirs) || dirs.length === 0) {
    return Promise.reject(new Error("缺少必填参数: dirs (非空字符串数组)"));
  }

  // API Key：优先使用传入的，其次环境变量，再次尝试 .env
  loadEnv();
  const resolvedApiKey = apiKey || process.env.MOONSHOT_API_KEY;
  if (!resolvedApiKey) {
    return Promise.reject(
      new Error(
        "未提供 Moonshot API Key，请通过 options.apiKey 传入或设置环境变量 MOONSHOT_API_KEY",
      ),
    );
  }

  // 检查 Python 脚本是否存在
  if (!fs.existsSync(pythonScript)) {
    return Promise.reject(
      new Error(`Python 脚本不存在: ${pythonScript}`),
    );
  }

  return new Promise((resolve, reject) => {
    const dirsJson = JSON.stringify(dirs);
    const args = [
      pythonScript,
      "--base-path", basePath,
      "--dirs", dirsJson,
      "--api-key", resolvedApiKey,
    ];

    const child = spawn(pythonPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutBuf = "";
    let stderrBuf = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // 5 秒后强制 kill
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 5000);
    }, timeout);

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");

    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderrBuf += chunk;
      if (onProgress) {
        // 逐行回调进度
        const lines = chunk.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            onProgress(trimmed);
          }
        }
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new Error(
          `无法启动 Python 进程: ${err.message}\n` +
            `Python 路径: ${pythonPath}\n` +
            `请确认已安装 Python 依赖: pip install -r ${IMAGE_ANALYSIS_DIR}/requirements.txt`,
        ),
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      if (timedOut) {
        reject(
          new Error(
            `图片分析超时 (${timeout / 1000}s)\n` +
              `stderr 最后输出:\n${stderrBuf.slice(-2000)}`,
          ),
        );
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            `Python 脚本异常退出 (exit code: ${code})\n` +
              `stderr:\n${stderrBuf.slice(-5000)}`,
          ),
        );
        return;
      }

      // 解析 stdout JSON
      let result;
      try {
        result = JSON.parse(stdoutBuf.trim());
      } catch (parseErr) {
        reject(
          new Error(
            `无法解析 Python 脚本输出的 JSON: ${parseErr.message}\n` +
              `stdout 前 1000 字符:\n${stdoutBuf.slice(0, 1000)}`,
          ),
        );
        return;
      }

      resolve(result);
    });
  });
}

// ============================================================
// CLI 入口：允许直接通过 node scripts/analyze-images.mjs 运行
// ============================================================
async function cli() {
  loadEnv();

  const basePath = process.env.IMAGE_BASE_PATH;
  const dirsRaw = process.env.IMAGE_DIR_SUFFIXES;
  const apiKey = process.env.MOONSHOT_API_KEY;

  if (!basePath || !dirsRaw || !apiKey) {
    console.error(
      "❌ 请设置环境变量 IMAGE_BASE_PATH, IMAGE_DIR_SUFFIXES, MOONSHOT_API_KEY",
    );
    console.error("   或在 .env 文件中配置，或通过代码调用 analyzeImages()");
    process.exit(1);
  }

  let dirs;
  try {
    dirs = JSON.parse(dirsRaw);
  } catch {
    console.error(`❌ IMAGE_DIR_SUFFIXES 不是有效的 JSON: ${dirsRaw}`);
    process.exit(1);
  }

  console.log("📷 开始图片分析...\n");

  try {
    const results = await analyzeImages({
      basePath,
      dirs,
      apiKey,
      onProgress: (line) => console.log(line),
    });

    const totalImages = Object.values(results).reduce(
      (sum, arr) => sum + arr.length,
      0,
    );
    const cities = Object.keys(results);
    console.log(`\n✅ 分析完成: ${cities.length} 个城市, ${totalImages} 张图片`);

    // 输出到文件（兼容旧的 workflow：fill-titles.mjs 会读取这个文件）
    const outputPath = path.join(basePath, "analysis_results.json");
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf-8");
    console.log(`   结果已写入: ${outputPath}`);
  } catch (err) {
    console.error(`\n❌ 分析失败: ${err.message}`);
    process.exit(1);
  }
}

// 如果直接运行此脚本（非 import），执行 CLI 模式
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  cli();
}
