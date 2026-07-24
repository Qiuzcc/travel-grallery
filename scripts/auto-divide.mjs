#!/usr/bin/env node
/**
 * 自动划分地区脚本
 *
 * 用法 (在项目根目录):
 *   npm run auto-divide
 *
 * 脚本会:
 *   - 扫描 public/gallery/auto-divide/ 下所有图片文件
 *   - 从 EXIF 中提取 GPS 坐标
 *   - 通过高德逆地理编码 API 获取县区级行政区名称
 *   - 在 public/gallery/ 下以县区名称创建目录（已存在则跳过）
 *   - 将照片移动到对应县区目录
 *   - 无 GPS 信息的照片移至 public/gallery/no-exif/
 *
 * 环境变量:
 *   AMAP_WEB_SERVICE_KEY      - 高德 Web服务 API Key (优先)
 *   VITE_AMAP_REST_API_KEY    - 高德 REST API Key (备选)
 *   两者都未配置则报错退出
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const EXTENSIONS = [".jpg", ".jpeg", ".png", ".heic"];
const GEOCODE_DELAY_MS = 200;

const galleryDir = path.join(projectRoot, "public", "gallery");
const autoDivideDir = path.join(galleryDir, "auto-divide");
const noExifDir = path.join(galleryDir, "no-exif");

// --- 读取 .env 文件获取 AMap Key ---
function loadEnvKey() {
  const envPath = path.join(projectRoot, ".env");
  if (!fs.existsSync(envPath)) return null;

  const content = fs.readFileSync(envPath, "utf-8");
  const lines = content.split("\n");

  let webServiceKey = null;
  let restApiKey = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    const value = rest.join("=").trim();
    if (key.trim() === "AMAP_WEB_SERVICE_KEY") webServiceKey = value;
    if (key.trim() === "VITE_AMAP_REST_API_KEY") restApiKey = value;
  }

  return webServiceKey || restApiKey || null;
}

// --- 逆地理编码：经纬度 -> 县区名称 ---
// 返回 { dirName, province, city, district }
// dirName 规则：县级市直接用 district（如"荣成市"）；
//               普通区/县携带上级市级前缀（如"威海市环翠区"）
async function reverseGeocodeDistrict(lat, lng, amapKey) {
  const url = `https://restapi.amap.com/v3/geocode/regeo?key=${amapKey}&location=${lng},${lat}&extensions=base`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status === "1" && data.regeocode?.addressComponent) {
    const { district, city, province } = data.regeocode.addressComponent;

    if (district && typeof district === "string") {
      // 判断是否为县级市：district 以"市"结尾
      const isCountyLevelCity = district.endsWith("市");
      const dirName = isCountyLevelCity
        ? district
        : `${city || ""}${district}`;
      return { dirName, province: province || "", city: city || "", district };
    }

    // district 为空时，尝试用 city
    if (city && typeof city === "string") {
      return { dirName: city, province: province || "", city, district: "" };
    }
    // 再尝试用 province
    if (province && typeof province === "string") {
      return { dirName: province, province, city: "", district: "" };
    }
  }

  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- 获取图片文件列表 ---
function getImageFiles() {
  return fs
    .readdirSync(autoDivideDir)
    .filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return EXTENSIONS.includes(ext);
    })
    .sort();
}

// --- 安全移动文件：支持跨文件系统 ---
function moveFile(src, destDir, filename) {
  fs.mkdirSync(destDir, { recursive: true });

  let targetName = filename;
  let targetPath = path.join(destDir, targetName);

  // 同名文件已存在时追加序号
  if (fs.existsSync(targetPath)) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    let counter = 1;
    while (fs.existsSync(targetPath)) {
      targetName = `${base}_${counter}${ext}`;
      targetPath = path.join(destDir, targetName);
      counter++;
    }
    console.log(`    ⚠ 同名文件已存在，重命名为: ${targetName}`);
  }

  // 先尝试 rename（同文件系统，原子操作）
  try {
    fs.renameSync(src, targetPath);
    return targetName;
  } catch {
    // 跨文件系统时 rename 会失败，回退到 copy + unlink
    fs.copyFileSync(src, targetPath);
    fs.unlinkSync(src);
    return targetName;
  }
}

// --- 主逻辑 ---
async function run() {
  // 校验 auto-divide 目录
  if (!fs.existsSync(autoDivideDir)) {
    console.error(`错误: 目录不存在: ${path.relative(projectRoot, autoDivideDir)}`);
    console.error(`\n请先创建目录并放入照片:`);
    console.error(`  mkdir -p public/gallery/auto-divide`);
    console.error(`  cp 照片/*.jpg public/gallery/auto-divide/`);
    process.exit(1);
  }

  const files = getImageFiles();

  if (files.length === 0) {
    console.log(
      `auto-divide/ 目录下没有找到图片文件 (支持: ${EXTENSIONS.join(", ")})`,
    );
    return;
  }

  // 加载 API Key
  const amapKey = loadEnvKey();
  if (!amapKey) {
    console.error("错误: 未配置高德 API Key");
    console.error(
      "请在 .env 中配置 AMAP_WEB_SERVICE_KEY 或 VITE_AMAP_REST_API_KEY",
    );
    process.exit(1);
  }

  console.log(`找到 ${files.length} 张图片，开始处理...\n`);

  // 动态加载 exif-parser
  let ExifParser;
  try {
    ExifParser = (await import("exif-parser")).default;
  } catch {
    console.error(
      "错误: 请先安装 exif-parser: npm install --save-dev exif-parser",
    );
    process.exit(1);
  }

  // 统计
  let movedCount = 0;
  let noGpsCount = 0;
  let apiErrorCount = 0;
  const districtStats = new Map(); // district -> count

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(autoDivideDir, file);

    let lat = 0;
    let lng = 0;

    // 提取 EXIF GPS
    try {
      const buffer = fs.readFileSync(filePath);
      const parser = ExifParser.create(buffer);
      const result = parser.parse();

      if (result.tags.GPSLatitude && result.tags.GPSLongitude) {
        lat = result.tags.GPSLatitude;
        lng = result.tags.GPSLongitude;
      }
    } catch {
      // EXIF 解析失败，视为无 GPS
    }

    // 无 GPS -> 移入 no-exif
    if (!lat || !lng) {
      console.log(
        `  [${i + 1}/${files.length}] ${file} → 无GPS，移入 no-exif/`,
      );
      moveFile(filePath, noExifDir, file);
      noGpsCount++;
      continue;
    }

    // 调用逆地理编码获取县区名称
    let dirName = null;
    try {
      const result = await reverseGeocodeDistrict(lat, lng, amapKey);
      if (result) {
        dirName = result.dirName;
      }
    } catch {
      // 网络错误
    }

    if (!dirName) {
      console.log(
        `  [${i + 1}/${files.length}] ${file} → 逆地理编码失败 (${lat.toFixed(4)}, ${lng.toFixed(4)})，移入 no-exif/`,
      );
      moveFile(filePath, noExifDir, file);
      apiErrorCount++;
      await sleep(GEOCODE_DELAY_MS);
      continue;
    }

    // 创建目标目录并移动文件
    const destDir = path.join(galleryDir, dirName);
    const movedName = moveFile(filePath, destDir, file);

    const count = (districtStats.get(dirName) || 0) + 1;
    districtStats.set(dirName, count);

    console.log(
      `  [${i + 1}/${files.length}] ${file} → ${dirName}${movedName !== file ? ` (重命名为 ${movedName})` : ""}  (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
    );
    movedCount++;

    await sleep(GEOCODE_DELAY_MS);
  }

  // 输出统计摘要
  console.log(`\n========== 处理完成 ==========`);
  console.log(`  总照片数: ${files.length}`);
  console.log(`  已分类:   ${movedCount}`);
  console.log(`  无GPS:    ${noGpsCount}`);
  if (apiErrorCount > 0) {
    console.log(`  API失败:  ${apiErrorCount}`);
  }

  if (districtStats.size > 0) {
    console.log(`\n  各县区分类统计:`);
    const sorted = [...districtStats.entries()].sort((a, b) => b[1] - a[1]);
    for (const [district, count] of sorted) {
      console.log(`    ${district}: ${count} 张`);
    }
  }

  if (noGpsCount > 0 || apiErrorCount > 0) {
    console.log(
      `\n  无GPS或API失败的照片已移至: public/gallery/no-exif/`,
    );
  }
}

run().catch((err) => {
  console.error("脚本执行出错:", err);
  process.exit(1);
});
