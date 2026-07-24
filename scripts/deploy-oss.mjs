#!/usr/bin/env node
/**
 * 阿里云 OSS 增量上传脚本
 *
 * 用法: npm run deploy
 *       npm run deploy -- --dry-run   (仅预览变更，不实际上传)
 *
 * 脚本会:
 *   - 扫描 dist/gallery/ 下所有文件，计算 MD5 哈希
 *   - 对比上次上传的 manifest（.oss-manifest.json）
 *   - 仅上传新增或变更的文件
 *   - 不删除 OSS 上已有的文件
 *   - 上传完成后更新本地 manifest
 *
 * 环境变量 (.env):
 *   OSS_REGION          - OSS 地域（如 oss-cn-beijing）
 *   OSS_BUCKET          - Bucket 名称
 *   OSS_ACCESS_KEY_ID   - AccessKey ID
 *   OSS_ACCESS_KEY_SECRET - AccessKey Secret
 *   OSS_PREFIX          - 上传路径前缀（可选，默认 "gallery/"）
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const DIST_DIR = path.join(projectRoot, "dist", "gallery");
const MANIFEST_FILE = path.join(projectRoot, ".oss-manifest.json");
const DRY_RUN = process.argv.includes("--dry-run");

// --- 读取 .env ---
function loadEnv() {
  const envPath = path.join(projectRoot, ".env");
  const env = {};

  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...rest] = trimmed.split("=");
      env[key.trim()] = rest.join("=").trim();
    }
  }

  return {
    region: process.env.OSS_REGION || env.OSS_REGION || "",
    bucket: process.env.OSS_BUCKET || env.OSS_BUCKET || "",
    accessKeyId: process.env.OSS_ACCESS_KEY_ID || env.OSS_ACCESS_KEY_ID || "",
    accessKeySecret:
      process.env.OSS_ACCESS_KEY_SECRET || env.OSS_ACCESS_KEY_SECRET || "",
    prefix: process.env.OSS_PREFIX || env.OSS_PREFIX || "gallery/",
  };
}

// --- 计算文件 MD5 ---
function fileMD5(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("md5").update(content).digest("hex");
}

// --- 递归扫描目录 ---
// excludeDirs: 要跳过的子目录名称列表（仅匹配顶层目录名）
function walkDir(dir, baseDir = dir, excludeDirs = []) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (excludeDirs.includes(entry.name)) {
        console.log(`  [跳过] ${path.relative(baseDir, fullPath)}/`);
        continue;
      }
      results.push(...walkDir(fullPath, baseDir, excludeDirs));
    } else if (entry.isFile()) {
      const relativePath = path.relative(baseDir, fullPath);
      results.push({ fullPath, relativePath });
    }
  }

  return results;
}

// --- 加载上次 manifest ---
function loadManifest() {
  try {
    if (fs.existsSync(MANIFEST_FILE)) {
      return JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf-8"));
    }
  } catch {
    // ignore
  }
  return {};
}

// --- 保存 manifest ---
function saveManifest(manifest) {
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2), "utf-8");
}

// --- 主逻辑 ---
async function run() {
  // 检查 dist 目录
  if (!fs.existsSync(DIST_DIR)) {
    console.error("错误: dist/gallery/ 目录不存在，请先运行 npm run build");
    process.exit(1);
  }

  // 加载配置
  const config = loadEnv();

  const prefix = (config.prefix || "gallery/").endsWith("/")
    ? config.prefix || "gallery/"
    : (config.prefix || "gallery/") + "/";

  if (!DRY_RUN) {
    const missing = [];
    if (!config.region) missing.push("OSS_REGION");
    if (!config.bucket) missing.push("OSS_BUCKET");
    if (!config.accessKeyId) missing.push("OSS_ACCESS_KEY_ID");
    if (!config.accessKeySecret) missing.push("OSS_ACCESS_KEY_SECRET");

    if (missing.length > 0) {
      console.error(`错误: 缺少环境变量: ${missing.join(", ")}`);
      console.error(`请在 .env 文件中配置以下变量:`);
      console.error(`  OSS_REGION=oss-cn-beijing`);
      console.error(`  OSS_BUCKET=your-bucket-name`);
      console.error(`  OSS_ACCESS_KEY_ID=your-access-key-id`);
      console.error(`  OSS_ACCESS_KEY_SECRET=your-access-key-secret`);
      console.error(`  OSS_PREFIX=gallery/  (可选，默认 gallery/)`);
      process.exit(1);
    }
  }

  // 要排除的子目录（不需要部署到 OSS 的目录）
  const EXCLUDE_DIRS = ["no-exif", "auto-divide"];

  // 扫描 dist/gallery/ 下所有文件
  console.log(`扫描 dist/gallery/ ...\n`);
  const files = walkDir(DIST_DIR, DIST_DIR, EXCLUDE_DIRS);

  const currentManifest = {};

  for (const file of files) {
    const key = prefix + file.relativePath.split(path.sep).join("/");
    currentManifest[key] = fileMD5(file.fullPath);
  }

  // 对比 manifest
  const prevManifest = loadManifest();
  const toUpload = [];

  for (const [relativePath, hash] of Object.entries(currentManifest)) {
    if (prevManifest[relativePath] !== hash) {
      toUpload.push(relativePath);
    }
  }

  console.log(`文件总数: ${files.length}`);
  console.log(`需上传:   ${toUpload.length} (新增或变更)`);
  console.log(`跳过:     ${files.length - toUpload.length} (未变更)\n`);

  if (toUpload.length === 0) {
    console.log("没有需要上传的文件，已是最新状态。");
    return;
  }

  // 列出变更文件
  for (const file of toUpload) {
    const isNew = !(file in prevManifest);
    const tag = isNew ? "[新增]" : "[变更]";
    console.log(`  ${tag} ${file}`);
  }

  if (DRY_RUN) {
    console.log(`\n[dry-run] 预览模式，未实际上传。`);
    return;
  }

  // 初始化 OSS Client
  console.log(`\n开始上传到 ${config.bucket} (${config.region}) ...\n`);

  const OSS = (await import("ali-oss")).default;
  const client = new OSS({
    region: config.region,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
  });

  let successCount = 0;
  let failCount = 0;
  const uploadedFiles = [];

  // 构建 ossKey → file 映射
  const fileMap = new Map();
  for (const file of files) {
    const key = prefix + file.relativePath.split(path.sep).join("/");
    fileMap.set(key, file);
  }

  for (let i = 0; i < toUpload.length; i++) {
    const ossKey = toUpload[i];
    const file = fileMap.get(ossKey);
    const localPath = file.fullPath;

    try {
      await client.put(ossKey, localPath);
      successCount++;
      uploadedFiles.push(ossKey);
      console.log(`  [${i + 1}/${toUpload.length}] ✓ ${ossKey}`);
    } catch (err) {
      failCount++;
      console.error(
        `  [${i + 1}/${toUpload.length}] ✗ ${ossKey} - ${err.message}`,
      );
    }
  }

  // 仅将成功上传的文件记入 manifest，失败的文件下次会重新上传
  const newManifest = { ...prevManifest };
  for (const file of uploadedFiles) {
    newManifest[file] = currentManifest[file];
  }
  saveManifest(newManifest);

  console.log(`\n上传完成!`);
  console.log(`  成功: ${successCount}`);
  if (failCount > 0) {
    console.log(`  失败: ${failCount}`);
  }
  console.log(`  Manifest 已更新: .oss-manifest.json`);
}

run().catch((err) => {
  console.error("脚本执行出错:", err);
  process.exit(1);
});
