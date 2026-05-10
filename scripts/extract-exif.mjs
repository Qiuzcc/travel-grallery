#!/usr/bin/env node
/**
 * EXIF 照片数据提取脚本
 *
 * 用法 (在项目根目录):
 *   npm run exif -- public/gallery/北京市
 *
 * 脚本会:
 *   - 扫描指定目录下所有图片文件
 *   - 提取 GPS 坐标和拍摄时间
 *   - 计算图片宽高比
 *   - 生成缩略图到 thumbnails/ 子目录 (400px 宽, JPEG 质量 80)
 *   - 通过高德逆地理编码 API 将经纬度转换为地名
 *   - 合并已有 photos.json 中的 title/description
 *   - 输出 photos.json 到指定目录
 *
 * 环境变量:
 *   AMAP_WEB_SERVICE_KEY - 高德 Web服务 API Key (优先)
 *   VITE_AMAP_KEY        - 高德 JS API Key (备选)
 *   如果都未配置，则跳过逆地理编码
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const EXTENSIONS = [".jpg", ".jpeg", ".png", ".heic"];
const THUMB_WIDTH = 400;
const THUMB_QUALITY = 80;
const GEOCODE_DELAY_MS = 200; // Rate limiting: 200ms between requests

// --- 参数校验 ---
const inputArg = process.argv[2];

if (!inputArg) {
  console.error(`错误: 请指定城市目录路径\n`);
  console.error(`用法: npm run exif -- <目录路径>`);
  console.error(`示例: npm run exif -- public/gallery/北京市`);
  console.error(`      npm run exif -- public/gallery/荣成市\n`);
  console.error(`目录路径相对于项目根目录，例如 public/gallery/北京市`);
  process.exit(1);
}

// 解析目录路径（支持相对路径和绝对路径）
const targetDir = path.isAbsolute(inputArg)
  ? inputArg
  : path.resolve(projectRoot, inputArg);

// 校验目录是否存在
if (!fs.existsSync(targetDir)) {
  console.error(`错误: 目录不存在: ${targetDir}`);
  console.error(`\n请先创建目录并放入照片，例如:`);
  console.error(`  mkdir -p public/gallery/荣成市`);
  console.error(`  cp 照片/*.jpg public/gallery/荣成市/`);
  process.exit(1);
}

// 校验是否为目录
const stat = fs.statSync(targetDir);
if (!stat.isDirectory()) {
  console.error(`错误: ${targetDir} 不是一个目录`);
  process.exit(1);
}

// 校验目录是否在 public/gallery/ 下
const galleryDir = path.join(projectRoot, "public", "gallery");
if (!targetDir.startsWith(galleryDir + path.sep)) {
  console.error(`错误: 目录必须在 public/gallery/ 下`);
  console.error(`  提供的路径: ${inputArg}`);
  console.error(`  期望路径格式: public/gallery/城市名`);
  process.exit(1);
}

// 城市名为目录名
const cityName = path.basename(targetDir);
const outputFile = path.join(targetDir, "photos.json");
const thumbDir = path.join(targetDir, "thumbnails");

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

  // 优先使用 AMAP_WEB_SERVICE_KEY，备选 VITE_AMAP_REST_API_KEY
  return webServiceKey || restApiKey || null;
}

// --- 地理编码（城市名 -> 中心坐标）---
async function geocodeCity(cityName, amapKey) {
  if (!amapKey || !cityName) return null;

  const url = `https://restapi.amap.com/v3/geocode/geo?key=${amapKey}&address=${encodeURIComponent(cityName)}&city=${encodeURIComponent(cityName)}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === "1" && data.geocodes && data.geocodes.length > 0) {
      const location = data.geocodes[0].location; // "lng,lat"
      const [lngStr, latStr] = location.split(",");
      return { lat: parseFloat(latStr), lng: parseFloat(lngStr) };
    }
  } catch {
    // Network error, skip silently
  }
  return null;
}

// --- 逆地理编码 ---
async function reverseGeocode(lat, lng, amapKey) {
  if (!amapKey || !lat || !lng) return "";

  const url = `https://restapi.amap.com/v3/geocode/regeo?key=${amapKey}&location=${lng},${lat}&extensions=base`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === "1" && data.regeocode) {
      const addr = data.regeocode.formatted_address;
      if (addr && typeof addr === "string") {
        return addr;
      }
    }
  } catch {
    // Network error, skip silently
  }
  return "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- 工具函数 ---
function getImageFiles() {
  return fs
    .readdirSync(targetDir)
    .filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return EXTENSIONS.includes(ext);
    })
    .sort();
}

function getAspectRatio(width, height) {
  if (!width || !height) return undefined;
  const ratio = width / height;
  if (ratio > 1.2) return "landscape";
  if (ratio < 0.8) return "portrait";
  return "square";
}

function loadExistingData() {
  try {
    if (fs.existsSync(outputFile)) {
      const raw = fs.readFileSync(outputFile, "utf-8");
      return JSON.parse(raw);
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

// --- 主逻辑 ---
async function run() {
  const files = getImageFiles();

  if (files.length === 0) {
    console.log(
      `[${cityName}] 目录下没有找到图片文件 (支持: ${EXTENSIONS.join(", ")})`,
    );
    const output = { city: cityName, lat: 0, lng: 0, photos: [] };
    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf-8");
    console.log(
      `已生成空的 photos.json: ${path.relative(projectRoot, outputFile)}`,
    );
    return;
  }

  console.log(`[${cityName}] 找到 ${files.length} 张图片，开始处理...\n`);

  // Load AMap key for reverse geocoding
  const amapKey = loadEnvKey();
  if (amapKey) {
    console.log(`  逆地理编码: 已加载高德 API Key，将自动转换坐标为地名\n`);
  } else {
    console.log(`  逆地理编码: 未配置 API Key，跳过地名转换`);
    console.log(
      `  (在 .env 中配置 AMAP_WEB_SERVICE_KEY 或 VITE_AMAP_KEY 启用)\n`,
    );
  }

  // Load existing data for merge
  const existing = loadExistingData();
  const existingMap = new Map();
  if (existing && Array.isArray(existing.photos)) {
    for (const p of existing.photos) {
      const filename = path.basename(p.src || "");
      if (filename) {
        existingMap.set(filename, p);
      }
    }
  }

  let ExifParser, sharp;
  try {
    ExifParser = (await import("exif-parser")).default;
  } catch {
    console.error(
      "错误: 请先安装 exif-parser: npm install --save-dev exif-parser",
    );
    process.exit(1);
  }
  try {
    sharp = (await import("sharp")).default;
  } catch {
    console.error("错误: 请先安装 sharp: npm install --save-dev sharp");
    process.exit(1);
  }

  const photos = [];
  const gpsPoints = [];

  // Create thumbnails directory
  fs.mkdirSync(thumbDir, { recursive: true });

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(targetDir, file);

    let lat = 0;
    let lng = 0;
    let date = "";
    let width = 0;
    let height = 0;

    // Try EXIF extraction
    try {
      const buffer = fs.readFileSync(filePath);
      const parser = ExifParser.create(buffer);
      const result = parser.parse();

      if (result.tags.GPSLatitude && result.tags.GPSLongitude) {
        lat = result.tags.GPSLatitude;
        lng = result.tags.GPSLongitude;
        gpsPoints.push({ lat, lng });
      }

      if (result.tags.DateTimeOriginal) {
        const d = new Date(result.tags.DateTimeOriginal * 1000);
        date = d.toISOString().split("T")[0];
      }

      if (result.tags.ImageWidth && result.tags.ImageHeight) {
        width = result.tags.ImageWidth;
        height = result.tags.ImageHeight;
      }
    } catch {
      // EXIF parse failed, try sharp for dimensions
    }

    // Use sharp for dimensions if EXIF didn't provide them
    if (!width || !height) {
      try {
        const metadata = await sharp(filePath).metadata();
        width = metadata.width || 0;
        height = metadata.height || 0;
      } catch {
        // ignore
      }
    }

    // Generate thumbnail
    const thumbName = `${path.parse(file).name}_thumb.jpg`;
    const thumbPath = path.join(thumbDir, thumbName);
    try {
      await sharp(filePath)
        .resize(THUMB_WIDTH, null, { withoutEnlargement: true })
        .jpeg({ quality: THUMB_QUALITY })
        .toFile(thumbPath);
    } catch (err) {
      console.log(`    ⚠ 缩略图生成失败: ${file} - ${err.message}`);
    }

    // Reverse geocoding
    const existingPhoto = existingMap.get(file);
    let location = existingPhoto?.location || "";

    if (!location && lat && lng && amapKey) {
      location = await reverseGeocode(lat, lng, amapKey);
      if (location) {
        console.log(`    📍 ${location}`);
      }
      // Rate limiting
      await sleep(GEOCODE_DELAY_MS);
    }

    // Merge with existing data
    const id = path.parse(file).name;

    const photo = {
      id,
      src: `/gallery/${cityName}/${file}`,
      thumbnail: `/gallery/${cityName}/thumbnails/${thumbName}`,
      title: existingPhoto?.title || "",
      description: existingPhoto?.description || "",
      date: date || existingPhoto?.date || "",
      lat: lat || existingPhoto?.lat || 0,
      lng: lng || existingPhoto?.lng || 0,
      location: location || existingPhoto?.location || "",
      aspectRatio: getAspectRatio(width, height),
    };

    photos.push(photo);

    const gpsInfo =
      lat && lng ? `GPS: ${lat.toFixed(4)}, ${lng.toFixed(4)}` : "无GPS";
    const dateInfo = date || "无日期";
    console.log(
      `  [${i + 1}/${files.length}] ${file} → ${gpsInfo} | ${dateInfo}`,
    );

    if (!lat && !lng) {
      console.log(`    ⚠ 警告: ${file} 没有 GPS 信息，需要手动补充坐标`);
    }
  }

  // Get city center from geocoding API
  let cityLat = 0;
  let cityLng = 0;
  if (amapKey) {
    const center = await geocodeCity(cityName, amapKey);
    if (center) {
      cityLat = center.lat;
      cityLng = center.lng;
      console.log(
        `\n  📍 城市中心 (API): ${cityLat.toFixed(4)}, ${cityLng.toFixed(4)}`,
      );
    }
  }
  // Fallback: average of GPS points
  if (!cityLat && !cityLng && gpsPoints.length > 0) {
    cityLat = gpsPoints.reduce((sum, p) => sum + p.lat, 0) / gpsPoints.length;
    cityLng = gpsPoints.reduce((sum, p) => sum + p.lng, 0) / gpsPoints.length;
    console.log(
      `\n  📍 城市中心 (照片平均): ${cityLat.toFixed(4)}, ${cityLng.toFixed(4)}`,
    );
  }

  const output = {
    city: cityName,
    lat: cityLat,
    lng: cityLng,
    photos,
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf-8");

  console.log(`\n完成! 已生成 ${path.relative(projectRoot, outputFile)}`);
  console.log(`  城市: ${cityName}`);
  console.log(`  中心坐标: ${cityLat.toFixed(4)}, ${cityLng.toFixed(4)}`);
  console.log(`  照片数: ${photos.length}`);
  console.log(`  缩略图: ${path.relative(projectRoot, thumbDir)}/`);

  const emptyTitles = photos.filter((p) => !p.title).length;
  if (emptyTitles > 0) {
    console.log(
      `\n提示: 有 ${emptyTitles} 张照片的标题为空，请编辑 photos.json 手动补充`,
    );
  }

  const emptyLocations = photos.filter(
    (p) => !p.location && p.lat && p.lng,
  ).length;
  if (emptyLocations > 0 && !amapKey) {
    console.log(
      `\n提示: 有 ${emptyLocations} 张照片有GPS但无地名，配置 .env 中的 API Key 后重新运行可自动填充`,
    );
  }
}

run().catch((err) => {
  console.error("脚本执行出错:", err);
  process.exit(1);
});
