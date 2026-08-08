#!/usr/bin/env node
/**
 * raw 照片自动分类脚本
 *
 * 扫描 public/raw/ 目录下的照片，提取 EXIF GPS 坐标，
 * 通过高德逆地理编码 API 获取县级行政区划（district），
 * 将照片自动移动到 public/gallery/<县级行政区>/ 目录下。
 *
 * 提取不到 GPS 的照片将被移入 public/raw/unclassified/。
 *
 * 用法:
 *   node scripts/classify-raw.mjs
 *
 * 环境变量:
 *   VITE_AMAP_REST_API_KEY - 高德 Web 服务 API Key（必填）
 *   AMAP_WEB_SERVICE_KEY   - 备选
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const RAW_DIR = path.join(projectRoot, "public", "raw");
const GALLERY_DIR = path.join(projectRoot, "public", "gallery");
const UNCLASSIFIED_DIR = path.join(RAW_DIR, "unclassified");

const EXTENSIONS = [".jpg", ".jpeg", ".png", ".heic"];
const GEOCODE_DELAY_MS = 200; // 高德 API 调用间隔（5 QPS）
const GEOCODE_MAX_RETRIES = 2; // API 调用失败重试次数

// ============================================================
// 工具函数
// ============================================================

/** 加载 .env 中的高德 API Key */
function loadAmapKey() {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 判断高德 addressComponent 中的字段值是否有效
 * 高德 API 可能返回空数组 [] 而非空字符串
 */
function getAddrField(value) {
  if (typeof value === "string" && value.trim() !== "" && value !== "[]") {
    return value.trim();
  }
  return "";
}

// ============================================================
// 目录名构建规则
// ============================================================

/**
 * 判断 district 是否为县级市/县/旗（不需要加市级前缀）
 * 市辖区（以"区"结尾）需要加前缀
 */
function isCountyLevel(district) {
  if (!district) return false;
  return (
    district.endsWith("市") ||
    district.endsWith("县") ||
    district.endsWith("旗")
  );
}

/**
 * 四省区（西藏、新疆、青海、内蒙古）：地广人稀，按县级行政区划分
 */
const COUNTY_LEVEL_PROVINCES = ["西藏", "新疆", "青海", "内蒙古"];

function isCountyLevelProvince(province) {
  return COUNTY_LEVEL_PROVINCES.some((p) => province.includes(p));
}

/**
 * 根据地址组件构建目标目录名
 *
 * 分区策略：
 * - 西藏/新疆/青海/内蒙古：按县级行政区划分
 *   · 县级市/县/旗 → 直接使用（如"哈巴河县"）
 *   · 市辖区 → 加市级前缀（如"乌鲁木齐市天山区"）
 *   · district 为空 → 回退到 city（如不设区的"博乐市"）
 * - 其他省份：按市一级行政区划分
 *   · 直接使用 city（如"南京市"、"宁波市"）
 *   · city 为空时回退到 province（如直辖市"北京市"）
 */
function buildDirName(district, city, province) {
  if (isCountyLevelProvince(province)) {
    // 四省区：县级粒度
    if (!district) return city || province || "";
    if (isCountyLevel(district)) return district;
    const prefix = city || province || "";
    return prefix ? prefix + district : district;
  }

  // 其他省份：市一级粒度
  return city || province || district || "";
}

// ============================================================
// 逆地理编码：坐标 → 地址组件 + 目录名
// ============================================================

/**
 * 调用高德逆地理编码 API，获取地址组件并计算目标目录名
 * @returns {Promise<{ dirName: string, district: string, city: string, province: string } | null>}
 */
async function getAddressInfo(
  lat,
  lng,
  amapKey,
  retries = GEOCODE_MAX_RETRIES,
) {
  const url = `https://restapi.amap.com/v3/geocode/regeo?key=${amapKey}&location=${lng},${lat}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.status === "1" && data.regeocode?.addressComponent) {
        const addrComp = data.regeocode.addressComponent;
        const district = getAddrField(addrComp.district);
        const city = getAddrField(addrComp.city);
        const province = getAddrField(addrComp.province);

        if (district || city || province) {
          const dirName = buildDirName(district, city, province);
          return { dirName, district, city, province };
        }
      }

      if (attempt < retries) {
        await sleep(GEOCODE_DELAY_MS * 2);
        continue;
      }
      return null;
    } catch {
      if (attempt < retries) {
        await sleep(GEOCODE_DELAY_MS * 2);
        continue;
      }
      return null;
    }
  }
  return null;
}

// ============================================================
// 目录匹配
// ============================================================

/**
 * 在 gallery 目录中查找匹配的目标目录
 * 1. 精确匹配
 * 2. 包含匹配（如 gallery 已有"阿勒泰地区哈巴河县"，可匹配 district "哈巴河县"）
 * 3. 都不匹配则返回 districtName 本身（将新建）
 */
function findTargetDir(districtName) {
  if (!fs.existsSync(GALLERY_DIR)) {
    fs.mkdirSync(GALLERY_DIR, { recursive: true });
    return districtName;
  }

  const entries = fs.readdirSync(GALLERY_DIR, { withFileTypes: true });
  const dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  // 1. 精确匹配
  if (dirNames.includes(districtName)) return districtName;

  // 2. 后缀匹配（双向）：
  //    a) gallery 目录名以 dirName 结尾 → 旧长名匹配新短名
  //       例: "阿勒泰地区哈巴河县".endsWith("哈巴河县") = true
  //    b) dirName 以 gallery 目录名结尾 → 新长名匹配旧短名
  //       例: "北京市东城区".endsWith("东城区") = true
  //    注意：使用 endsWith 而非 includes，避免
  //    "南京市玄武区" 被误匹配到 "南京市" 目录
  for (const name of dirNames) {
    if (name.endsWith(districtName) || districtName.endsWith(name)) return name;
  }

  // 3. 无匹配，新建
  return districtName;
}

// ============================================================
// EXIF 提取
// ============================================================

/**
 * 从图片文件中提取 GPS 坐标（同步，exif-parser 的 parse 是同步的）
 * @param {string} filePath - 图片文件路径
 * @param {Object} ExifParser - exif-parser 模块
 * @returns {{ lat: number, lng: number } | null}
 */
function extractGPS(filePath, ExifParser) {
  try {
    const buffer = fs.readFileSync(filePath);
    const parser = ExifParser.create(buffer);
    const result = parser.parse();

    if (result.tags.GPSLatitude && result.tags.GPSLongitude) {
      return {
        lat: result.tags.GPSLatitude,
        lng: result.tags.GPSLongitude,
      };
    }
  } catch {
    // EXIF 解析失败
  }
  return null;
}

// ============================================================
// 主逻辑
// ============================================================

async function run() {
  // ---- 检查 raw 目录 ----
  if (!fs.existsSync(RAW_DIR)) {
    console.error("❌ public/raw/ 目录不存在，请先创建并放入照片");
    console.error(`   期望路径: ${RAW_DIR}`);
    process.exit(1);
  }

  // ---- 加载高德 API Key ----
  const amapKey = loadAmapKey();
  if (!amapKey) {
    console.error("❌ 未配置高德 API Key");
    console.error(
      "   请在 .env 中设置 VITE_AMAP_REST_API_KEY 或 AMAP_WEB_SERVICE_KEY",
    );
    process.exit(1);
  }

  // ---- 加载 exif-parser ----
  let ExifParser;
  try {
    ExifParser = (await import("exif-parser")).default;
  } catch {
    console.error(
      "❌ 请先安装 exif-parser: npm install --save-dev exif-parser",
    );
    process.exit(1);
  }

  // ---- 扫描图片文件 ----
  const allEntries = fs.readdirSync(RAW_DIR, { withFileTypes: true });
  const imageFiles = allEntries
    .filter((entry) => {
      if (!entry.isFile()) return false;
      const ext = path.extname(entry.name).toLowerCase();
      return EXTENSIONS.includes(ext);
    })
    .map((entry) => entry.name)
    .sort();

  if (imageFiles.length === 0) {
    console.log("📭 public/raw/ 目录下没有图片文件，无需处理");
    console.log(`   支持的格式: ${EXTENSIONS.join(", ")}`);
    process.exit(0);
  }

  console.log(`📷 发现 ${imageFiles.length} 张照片，开始处理...\n`);

  // ---- 逐张处理 ----
  const results = {
    classified: [], // { file, district, destDir, isNew }
    unclassified: [], // { file, reason }
    skipped: [], // { file, reason }
    errors: [], // { file, reason }
  };

  // 缓存地理编码结果：相同坐标不重复请求 API
  const geocodeCache = new Map();

  for (let i = 0; i < imageFiles.length; i++) {
    const file = imageFiles[i];
    const srcPath = path.join(RAW_DIR, file);
    const prefix = `[${i + 1}/${imageFiles.length}]`;

    // 提取 GPS
    const gps = extractGPS(srcPath, ExifParser);

    if (!gps || !gps.lat || !gps.lng) {
      // 无 GPS → 移到 unclassified
      console.log(`  ${prefix} ${file} → ⚠ 无 GPS 信息，移入 unclassified/`);
      results.unclassified.push({ file, reason: "无 GPS 信息" });
      continue;
    }

    const coordKey = `${gps.lat.toFixed(5)},${gps.lng.toFixed(5)}`;

    // 逆地理编码（使用缓存，缓存完整地址信息）
    let addrInfo;
    if (geocodeCache.has(coordKey)) {
      addrInfo = geocodeCache.get(coordKey);
      console.log(`  ${prefix} ${file} → 📍 ${addrInfo.dirName} (缓存)`);
    } else {
      addrInfo = await getAddressInfo(gps.lat, gps.lng, amapKey);
      geocodeCache.set(coordKey, addrInfo);

      if (addrInfo) {
        console.log(
          `  ${prefix} ${file} → 📍 ${addrInfo.dirName} (${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)})`,
        );
      } else {
        console.log(
          `  ${prefix} ${file} → ⚠ 逆地理编码失败 (${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)})，移入 unclassified/`,
        );
        results.unclassified.push({
          file,
          reason: `逆地理编码失败 (${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)})`,
        });
        await sleep(GEOCODE_DELAY_MS);
        continue;
      }

      await sleep(GEOCODE_DELAY_MS);
    }

    if (!addrInfo?.dirName) {
      results.unclassified.push({ file, reason: "无法确定县级行政区" });
      continue;
    }

    const districtName = addrInfo.dirName;

    // 匹配目标目录
    const targetDirName = findTargetDir(districtName);
    const targetDir = path.join(GALLERY_DIR, targetDirName);
    const destPath = path.join(targetDir, file);
    const isNewDir = !fs.existsSync(targetDir);

    // 检查同名文件冲突
    if (!isNewDir && fs.existsSync(destPath)) {
      console.log(`    ⚠ 目标目录已存在同名文件，跳过`);
      results.skipped.push({
        file,
        reason: `目标目录 ${targetDirName} 中已存在同名文件`,
      });
      continue;
    }

    // 创建目标目录（如需要）
    if (isNewDir) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 移动文件
    try {
      fs.renameSync(srcPath, destPath);
      results.classified.push({
        file,
        district: addrInfo.district || addrInfo.city || "",
        dirName: districtName,
        destDir: targetDirName,
        isNew: isNewDir,
      });
      const newTag = isNewDir ? " 🆕" : "";
      console.log(`    → ${targetDirName}/${file}${newTag}`);
    } catch (err) {
      console.log(`    ❌ 移动失败: ${err.message}`);
      results.errors.push({ file, reason: `移动失败: ${err.message}` });
    }
  }

  // ---- 移动无 GPS 照片到 unclassified ----
  if (results.unclassified.length > 0) {
    fs.mkdirSync(UNCLASSIFIED_DIR, { recursive: true });
    for (const item of results.unclassified) {
      const srcPath = path.join(RAW_DIR, item.file);
      const destPath = path.join(UNCLASSIFIED_DIR, item.file);
      if (fs.existsSync(srcPath)) {
        try {
          // 检查目标是否存在
          if (fs.existsSync(destPath)) {
            console.log(`    ⚠ unclassified/ 已存在 ${item.file}，跳过`);
            continue;
          }
          fs.renameSync(srcPath, destPath);
        } catch (err) {
          console.log(
            `    ❌ 移动 ${item.file} 到 unclassified 失败: ${err.message}`,
          );
        }
      }
    }
  }

  // ---- 输出结果 ----
  const total = imageFiles.length;
  const successCount = results.classified.length;
  const unclassifiedCount = results.unclassified.length;
  const skippedCount = results.skipped.length;
  const errorCount = results.errors.length;
  const failedCount = unclassifiedCount + skippedCount + errorCount;

  console.log(`\n${"=".repeat(60)}`);

  if (failedCount === 0 && successCount === total) {
    // 全部成功
    console.log(`✅ 全部 ${total} 张照片已成功自动分类！`);
    if (results.classified.some((r) => r.isNew)) {
      const newDirs = [
        ...new Set(
          results.classified.filter((r) => r.isNew).map((r) => r.destDir),
        ),
      ];
      console.log(`\n📁 新建了 ${newDirs.length} 个县级目录:`);
      for (const dir of newDirs) {
        console.log(`   - ${dir}`);
      }
    }
  } else if (failedCount === total) {
    // 全部失败
    console.log(`❌ 全部 ${total} 张照片未能自动分类`);
    if (unclassifiedCount > 0) {
      console.log(`\n   无法分类的照片 (${unclassifiedCount} 张):`);
      for (const item of results.unclassified) {
        console.log(`   - ${item.file}: ${item.reason}`);
      }
    }
  } else {
    // 部分成功
    console.log(
      `⚠ 部分成功: ${successCount}/${total} 张已分类, ${failedCount} 张未分类`,
    );
    if (successCount > 0) {
      console.log(`\n✅ 已分类照片 (${successCount} 张):`);
      const byDir = new Map();
      for (const item of results.classified) {
        if (!byDir.has(item.destDir)) byDir.set(item.destDir, []);
        byDir.get(item.destDir).push(item.file);
      }
      for (const [dir, files] of byDir) {
        const isNew = results.classified.find((r) => r.destDir === dir)?.isNew;
        const marker = isNew ? " 🆕" : "";
        console.log(`   ${dir}/ (${files.length} 张)${marker}`);
      }
    }
    if (unclassifiedCount > 0) {
      console.log(
        `\n⚠ 无法分类的照片 (${unclassifiedCount} 张) → public/raw/unclassified/`,
      );
      for (const item of results.unclassified) {
        console.log(`   - ${item.file}: ${item.reason}`);
      }
    }
    if (skippedCount > 0) {
      console.log(`\n⏭ 跳过的照片 (${skippedCount} 张):`);
      for (const item of results.skipped) {
        console.log(`   - ${item.file}: ${item.reason}`);
      }
    }
    if (errorCount > 0) {
      console.log(`\n❌ 移动失败的照片 (${errorCount} 张):`);
      for (const item of results.errors) {
        console.log(`   - ${item.file}: ${item.reason}`);
      }
    }
  }

  // ---- 后续提示 ----
  if (successCount > 0) {
    console.log(`\n${"-".repeat(60)}`);
    console.log(
      "💡 提示: 照片已移动到 gallery 目录，请运行以下命令重新生成数据:",
    );
    console.log("   # 对新增的目录逐个生成 photos.json 和缩略图:");
    const newDirs = [...new Set(results.classified.map((r) => r.destDir))];
    for (const dir of newDirs) {
      console.log(`   npm run exif -- public/gallery/${dir}`);
    }
    console.log("   # 重新聚合所有城市数据:");
    console.log("   npm run build:data");
  }

  // ---- 退出码 ----
  if (errorCount > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("脚本执行出错:", err);
  process.exit(1);
});
