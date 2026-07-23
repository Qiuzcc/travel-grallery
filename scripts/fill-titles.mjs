#!/usr/bin/env node
/**
 * 填充照片标题和描述脚本
 *
 * 用法: 在项目根目录运行 node scripts/fill-titles.mjs
 *
 * 脚本会:
 *   - 读取 public/gallery/analysis_results.json
 *   - 遍历各个城市的分析结果
 *   - 将标题和描述填充到对应城市 photos.json 的照片对象中
 *   - 如果 photos.json 中已有标题或描述，则不覆盖
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const galleryDir = path.join(projectRoot, "public", "gallery");
const analysisFile = path.join(galleryDir, "analysis_results.json");

/**
 * 清理标题中的 markdown 加粗标记 **
 */
function cleanTitle(raw) {
  if (!raw) return "";
  return raw
    .replace(/^\*{1,2}\s*/, "")
    .replace(/\s*\*{1,2}$/, "")
    .trim();
}

/**
 * 清理描述中的 markdown 标记和 "描述：" 前缀
 */
function cleanDescription(raw) {
  if (!raw) return "";
  return raw
    .replace(/^\*{1,2}描述[：:]\s*\*{1,2}\s*/, "")
    .replace(/^\*{1,2}\s*/, "")
    .replace(/\s*\*{1,2}$/, "")
    .trim();
}

/**
 * 从 src 路径中提取文件名
 * 例如: "/gallery/成都市/DJI_20260630175126_0010_D.JPG" → "DJI_20260630175126_0010_D.JPG"
 */
function getFilenameFromSrc(src) {
  if (!src) return "";
  return path.basename(src);
}

function run() {
  // 1. 读取分析结果
  if (!fs.existsSync(analysisFile)) {
    console.error(`❌ 分析结果文件不存在: ${analysisFile}`);
    process.exit(1);
  }

  const analysisData = JSON.parse(fs.readFileSync(analysisFile, "utf-8"));
  const cities = Object.keys(analysisData);

  console.log(`找到 ${cities.length} 个城市的分析结果\n`);

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalNotFound = 0;

  for (const cityName of cities) {
    const analysisEntries = analysisData[cityName];
    const photosJsonPath = path.join(galleryDir, cityName, "photos.json");

    // 检查对应的 photos.json 是否存在
    if (!fs.existsSync(photosJsonPath)) {
      console.log(`⚠️  ${cityName}: photos.json 不存在，跳过`);
      continue;
    }

    // 读取 photos.json
    const photosData = JSON.parse(fs.readFileSync(photosJsonPath, "utf-8"));
    const photos = photosData.photos;

    if (!photos || photos.length === 0) {
      console.log(`⚠️  ${cityName}: photos 数组为空，跳过`);
      continue;
    }

    let cityUpdated = 0;
    let citySkipped = 0;
    let cityNotFound = 0;

    for (const entry of analysisEntries) {
      const targetFilename = entry.file_name;

      // 在 photos 数组中根据 src 的文件名匹配
      const matchedPhoto = photos.find((photo) => {
        return getFilenameFromSrc(photo.src) === targetFilename;
      });

      if (!matchedPhoto) {
        console.log(
          `  ❓ ${cityName}/${targetFilename}: 在 photos.json 中未找到匹配照片`,
        );
        cityNotFound++;
        totalNotFound++;
        continue;
      }

      const cleanT = cleanTitle(entry.title);
      const cleanD = cleanDescription(entry.description);

      let didUpdate = false;

      // 仅在原字段为空时才填充
      if (!matchedPhoto.title || matchedPhoto.title.trim() === "") {
        matchedPhoto.title = cleanT;
        didUpdate = true;
      }

      if (!matchedPhoto.description || matchedPhoto.description.trim() === "") {
        matchedPhoto.description = cleanD;
        didUpdate = true;
      }

      if (didUpdate) {
        cityUpdated++;
        totalUpdated++;
      } else {
        citySkipped++;
        totalSkipped++;
      }
    }

    // 写回 photos.json（仅在有更新时）
    if (cityUpdated > 0) {
      fs.writeFileSync(
        photosJsonPath,
        JSON.stringify(photosData, null, 2),
        "utf-8",
      );
    }

    console.log(
      `  ${cityName}: ✅ 更新 ${cityUpdated} 张, ⏭️ 跳过 ${citySkipped} 张` +
        (cityNotFound > 0 ? `, ❓ 未找到 ${cityNotFound} 张` : ""),
    );
  }

  console.log(`\n====================`);
  console.log(
    `总计: ✅ 更新 ${totalUpdated} 张, ⏭️ 跳过 ${totalSkipped} 张, ❓ 未找到 ${totalNotFound} 张`,
  );
  console.log(`完成!`);
}

run();
