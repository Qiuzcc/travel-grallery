#!/usr/bin/env node
/**
 * 前序工作流：数据生产、构建与预览
 *
 * 串联 classify-raw → 分类结果检查 → extract-exif → AI标题生成 → build-data → 启动预览，
 * 若自动分类后有未处理照片则阻塞流程，提示用户手动处理后再重新运行。
 *
 * 用法:
 *   node scripts/prebuild.mjs
 *   npm run prebuild
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { analyzeImages } from "./analyze-images.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const RAW_DIR = path.join(projectRoot, "public", "raw");
const GALLERY_DIR = path.join(projectRoot, "public", "gallery");
const UNCLASSIFIED_DIR = path.join(RAW_DIR, "unclassified");

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".heic"];

/** 非城市图库目录，工作流各步骤自动跳过 */
const SKIP_DIRS = new Set(["images"]);

// ============================================================
// 工具函数
// ============================================================

/** 判断是否为图片文件 */
function isImageFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

/** 获取目录下直接的图片文件（不递归子目录） */
function getImageFilesInDir(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((f) => {
      const fullPath = path.join(dirPath, f);
      try {
        return fs.statSync(fullPath).isFile() && isImageFile(f);
      } catch {
        return false;
      }
    })
    .sort();
}

/** 获取 gallery 下所有子目录名（排除 SKIP_DIRS 中的非城市目录） */
function getGallerySubdirs() {
  if (!fs.existsSync(GALLERY_DIR)) return [];
  return fs
    .readdirSync(GALLERY_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name))
    .map((e) => e.name);
}

/** 运行 Node 脚本并等待完成，stdio 继承以实时显示输出 */
function runScript(scriptPath, args = []) {
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

/**
 * 判断某个 gallery 子目录是否需要运行 extract-exif
 * 条件：没有 photos.json，或目录下有 photos.json 中未记录的新照片
 */
function needsExifProcessing(dirName) {
  const dirPath = path.join(GALLERY_DIR, dirName);
  const photosJsonPath = path.join(dirPath, "photos.json");

  // 没有 photos.json → 需要处理
  if (!fs.existsSync(photosJsonPath)) return true;

  // 目录下没有图片 → 跳过
  const imageFiles = getImageFilesInDir(dirPath);
  if (imageFiles.length === 0) return false;

  // 解析已有 photos.json，检查是否有新照片
  let existingData;
  try {
    existingData = JSON.parse(fs.readFileSync(photosJsonPath, "utf-8"));
  } catch {
    // photos.json 损坏 → 重新生成
    return true;
  }

  const existingFiles = new Set(
    (existingData.photos || []).map((p) => path.basename(p.src || "")),
  );

  // 如果有照片不在 photos.json 中 → 需要重新提取
  return imageFiles.some((f) => !existingFiles.has(f));
}

// ============================================================
// AI 标题生成辅助函数
// ============================================================

/** 读取并解析指定目录的 photos.json */
function loadPhotosJson(dirName) {
  const jsonPath = path.join(GALLERY_DIR, dirName, "photos.json");
  if (!fs.existsSync(jsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * 检查 photos.json 中是否有标题和描述均为空的照片
 * @returns {{ dirName: string, emptyFiles: string[] } | null}
 */
function getEmptyTitlePhotos(dirName) {
  const data = loadPhotosJson(dirName);
  if (!data || !Array.isArray(data.photos) || data.photos.length === 0) {
    return null;
  }

  const emptyFiles = data.photos
    .filter((p) => !p.title && !p.description)
    .map((p) => path.basename(p.src || ""))
    .filter(Boolean);

  if (emptyFiles.length === 0) return null;

  return { dirName, emptyFiles };
}

/**
 * 将 AI 分析结果回填到 photos.json 中
 * @param {string} dirName - 目录名
 * @param {Array<{file_name: string, title: string, description: string}>} results - AI 分析结果
 * @returns {{ filled: number, skipped: number }}
 */
function fillTitlesFromAnalysis(dirName, results) {
  const jsonPath = path.join(GALLERY_DIR, dirName, "photos.json");
  const data = loadPhotosJson(dirName);
  if (!data || !Array.isArray(data.photos)) {
    return { filled: 0, skipped: 0 };
  }

  let filled = 0;
  let skipped = 0;

  for (const photo of data.photos) {
    // 只填充原本标题和描述均为空的照片
    if (photo.title || photo.description) {
      skipped++;
      continue;
    }

    const fileName = path.basename(photo.src || "");
    const aiResult = results.find((r) => r.file_name === fileName);
    if (aiResult && (aiResult.title || aiResult.description)) {
      photo.title = aiResult.title || "";
      photo.description = aiResult.description || "";
      filled++;
    }
  }

  // 写回文件
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf-8");
  return { filled, skipped };
}

// ============================================================
// 打印未分类照片详情并退出
// ============================================================

function blockAndExit(remainingInRaw, unclassifiedPhotos) {
  console.log();
  console.log("⚠️  以下照片未能自动分类，需要手动处理：");
  console.log();

  if (remainingInRaw.length > 0) {
    console.log(`   📂 public/raw/ 中剩余 ${remainingInRaw.length} 张照片:`);
    for (const f of remainingInRaw) {
      console.log(`      - ${f}`);
    }
    console.log();
    console.log("   👉 可能原因：目标目录已存在同名文件、文件移动失败等");
    console.log(
      "   👉 请手动将这些照片移动到正确的 gallery 子目录，或删除不需要的照片",
    );
    console.log();
  }

  if (unclassifiedPhotos.length > 0) {
    console.log(
      `   📂 public/raw/unclassified/ 中有 ${unclassifiedPhotos.length} 张照片（无 GPS 信息）:`,
    );
    for (const f of unclassifiedPhotos) {
      console.log(`      - ${f}`);
    }
    console.log();
    console.log("   👉 这些照片缺少 GPS 信息，无法自动确定所属城市");
    console.log("   👉 请手动确定其拍摄地点后移动到对应 gallery 子目录");
    console.log(
      "   👉 或使用工具补充 EXIF GPS 信息后，将照片放回 public/raw/ 重新运行",
    );
    console.log();
  }

  console.log("=".repeat(60));
  console.log("⛔ 工作流已暂停，请手动处理上述照片后重新运行:");
  console.log("   npm run prebuild");
  console.log("=".repeat(60));
  process.exit(1);
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  console.log("=".repeat(60));
  console.log("📸 前序工作流：数据生产、构建与预览");
  console.log("=".repeat(60));
  console.log();

  // ---- Step 1: 自动分类 ----
  console.log("▶ 步骤 1/5: 自动分类 raw 目录照片");
  console.log("-".repeat(40));

  // 快照：记录分类前的 gallery 子目录
  const dirsBefore = new Set(getGallerySubdirs());

  // 检查 raw 目录是否有照片
  const rawPhotosBefore = getImageFilesInDir(RAW_DIR);
  if (rawPhotosBefore.length === 0) {
    console.log("📭 public/raw/ 目录下没有照片，跳过分类步骤");
    console.log();
  } else {
    console.log(`📷 发现 ${rawPhotosBefore.length} 张待分类照片\n`);

    try {
      await runScript(path.join(__dirname, "classify-raw.mjs"));
    } catch (err) {
      console.error(`\n❌ 自动分类脚本执行失败: ${err.message}`);
      process.exit(1);
    }

    // ---- 检查分类结果 ----
    console.log();
    console.log("-".repeat(40));
    console.log("🔍 检查分类结果...");

    const remainingInRaw = getImageFilesInDir(RAW_DIR);
    const unclassifiedPhotos = getImageFilesInDir(UNCLASSIFIED_DIR);

    if (remainingInRaw.length > 0 || unclassifiedPhotos.length > 0) {
      blockAndExit(remainingInRaw, unclassifiedPhotos);
    }

    console.log("✅ 全部照片已成功自动分类！");
    console.log();
  }

  // ---- Step 2: EXIF 数据提取 ----
  console.log("▶ 步骤 2/5: 提取 EXIF 数据并生成 photos.json");
  console.log("-".repeat(40));

  // 找出新增的 gallery 子目录
  const dirsAfter = new Set(getGallerySubdirs());
  const newDirs = [...dirsAfter].filter((d) => !dirsBefore.has(d));

  // 筛选需要处理的目录：新目录 + 已有目录中有新照片的
  const dirsToProcess = [...dirsAfter].filter((dirName) =>
    needsExifProcessing(dirName),
  );

  // 标记哪些是新目录
  const newDirSet = new Set(newDirs);

  if (dirsToProcess.length === 0) {
    console.log("📭 所有目录的 photos.json 均为最新，跳过");
    console.log();
  } else {
    console.log(`📁 需要处理 ${dirsToProcess.length} 个目录:`);
    console.log();
    for (const dirName of dirsToProcess) {
      const tag = newDirSet.has(dirName) ? " 🆕 新目录" : " 📷 有新照片";
      console.log(`   - ${dirName}${tag}`);
    }
    console.log();

    let successCount = 0;
    let failCount = 0;

    for (const dirName of dirsToProcess) {
      const dirPath = path.join("public", "gallery", dirName);
      console.log(`  [${dirName}] 开始提取...`);
      try {
        await runScript(path.join(__dirname, "extract-exif.mjs"), [dirPath]);
        successCount++;
      } catch (err) {
        console.error(`  [${dirName}] ❌ 处理失败: ${err.message}`);
        failCount++;
      }
      console.log();
    }

    console.log(`EXIF 提取完成: ${successCount} 成功, ${failCount} 失败`);

    if (failCount > 0) {
      console.error(
        `❌ ${failCount} 个目录的 EXIF 提取失败，数据不完整，无法继续后续步骤`,
      );
      console.error("   请检查上述错误信息，修复后重新运行 npm run prebuild");
      process.exit(1);
    }

    console.log();
  }

  // ---- Step 3: AI 自动生成标题和描述 ----
  console.log("▶ 步骤 3/5: AI 自动生成照片标题和描述");
  console.log("-".repeat(40));

  // 扫描所有 gallery 子目录，找出标题和描述均为空的照片
  const allDirs = getGallerySubdirs();
  const dirsNeedingAI = [];
  let totalEmptyPhotos = 0;

  for (const dirName of allDirs) {
    const result = getEmptyTitlePhotos(dirName);
    if (result) {
      dirsNeedingAI.push(result);
      totalEmptyPhotos += result.emptyFiles.length;
    }
  }

  if (dirsNeedingAI.length === 0) {
    console.log("📭 所有照片均已有标题或描述，跳过 AI 生成");
    console.log();
  } else {
    console.log(
      `🤖 发现 ${dirsNeedingAI.length} 个目录共 ${totalEmptyPhotos} 张照片需要 AI 生成标题:`,
    );
    console.log();
    for (const item of dirsNeedingAI) {
      console.log(`   - ${item.dirName}: ${item.emptyFiles.length} 张`);
    }
    console.log();

    // 检查是否有 MOONSHOT_API_KEY
    const moonshotKey =
      process.env.MOONSHOT_API_KEY ||
      (() => {
        // 尝试从 .env 读取
        const envPath = path.join(projectRoot, ".env");
        if (!fs.existsSync(envPath)) return null;
        const content = fs.readFileSync(envPath, "utf-8");
        const match = content.match(/^MOONSHOT_API_KEY=(.+)$/m);
        return match ? match[1].trim() : null;
      })();

    if (!moonshotKey) {
      console.log("⚠️  未配置 MOONSHOT_API_KEY，跳过 AI 标题生成");
      console.log(
        "   请在 .env 中设置 MOONSHOT_API_KEY 后重新运行 npm run prebuild",
      );
      console.log();
    } else {
      // 构建 dirs 参数（analyzeImages 要求以 "/" 开头）
      const dirsParam = dirsNeedingAI.map((item) => `/${item.dirName}`);

      try {
        console.log("🚀 正在调用 AI 分析服务，请耐心等待...\n");

        const analysisResults = await analyzeImages({
          basePath: GALLERY_DIR,
          dirs: dirsParam,
          apiKey: moonshotKey,
          onProgress: (line) => console.log(`  [AI] ${line}`),
        });

        console.log();

        // 将结果回填到各自的 photos.json
        let totalFilled = 0;
        let totalSkipped = 0;

        for (const item of dirsNeedingAI) {
          const dirName = item.dirName;
          // analyzeImages 返回的 key 可能是目录名本身或带 "/" 前缀
          const resultsForKey =
            analysisResults[dirName] || analysisResults[`/${dirName}`] || [];

          if (resultsForKey.length === 0) {
            console.log(`  [${dirName}] ⚠️ AI 未返回结果，跳过`);
            continue;
          }

          const { filled, skipped } = fillTitlesFromAnalysis(
            dirName,
            resultsForKey,
          );
          totalFilled += filled;
          totalSkipped += skipped;

          console.log(
            `  [${dirName}] ✅ 填充 ${filled} 张，跳过 ${skipped} 张（已有标题）`,
          );
        }

        console.log();
        console.log(`AI 标题生成完成: 共填充 ${totalFilled} 张照片`);
        console.log();
      } catch (err) {
        console.error(`\n❌ AI 分析失败: ${err.message}`);
        console.log("   工作流将继续执行后续步骤\n");
      }
    }
  }

  // ---- Step 4: 数据聚合 ----
  console.log("▶ 步骤 4/5: 聚合数据并生成 Atom 订阅源");
  console.log("-".repeat(40));

  try {
    await runScript(path.join(__dirname, "build-data.mjs"));
  } catch (err) {
    console.error(`\n❌ 数据聚合失败: ${err.message}`);
    process.exit(1);
  }

  // ---- Step 5: 启动本地预览 ----
  console.log("▶ 步骤 5/5: 启动本地开发服务器预览");
  console.log("-".repeat(40));

  // 检查 node_modules 中是否有 vite
  const viteBin = path.join(projectRoot, "node_modules", ".bin", "vite");
  if (!fs.existsSync(viteBin)) {
    console.error("❌ 未找到 vite，请先运行 npm install");
    process.exit(1);
  }

  console.log("🚀 正在启动 Vite 开发服务器...");
  console.log("   按 Ctrl+C 停止服务器");
  console.log();

  await new Promise((resolve, reject) => {
    const child = spawn(viteBin, [], {
      cwd: projectRoot,
      stdio: "inherit",
    });

    child.on("close", (code) => {
      // 用户主动 Ctrl+C 退出是正常行为
      resolve();
    });

    child.on("error", (err) => {
      reject(new Error(`无法启动 Vite: ${err.message}`));
    });
  });

  // ---- 完成 ----
  console.log();
  console.log("=".repeat(60));
  console.log("🎉 前序工作流执行完毕！");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("工作流出错:", err);
  process.exit(1);
});
