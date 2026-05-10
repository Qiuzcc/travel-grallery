#!/usr/bin/env node
/**
 * 照片数据聚合脚本
 *
 * 用法: 在项目根目录运行 node scripts/build-data.mjs
 *
 * 脚本会:
 *   - 扫描 public/gallery/ 下所有含 photos.json 的子目录
 *   - 按各城市最早照片时间排序
 *   - 聚合输出到 src/data/generated-photos.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public", "gallery");
const outputFile = path.join(
  projectRoot,
  "src",
  "data",
  "generated-photos.json",
);

function getEarliestDate(photos) {
  const dates = photos.map((p) => p.date).filter((d) => d && d !== "");

  if (dates.length === 0) return null;

  return dates.sort()[0];
}

function run() {
  // Scan public/gallery/ for subdirectories containing photos.json
  const entries = fs.readdirSync(publicDir, { withFileTypes: true });
  const cityDirs = entries.filter((e) => e.isDirectory());

  const cities = [];

  for (const dir of cityDirs) {
    const photosJsonPath = path.join(publicDir, dir.name, "photos.json");

    if (!fs.existsSync(photosJsonPath)) {
      continue;
    }

    let data;
    try {
      const raw = fs.readFileSync(photosJsonPath, "utf-8");
      data = JSON.parse(raw);
    } catch (err) {
      console.warn(`⚠ 跳过 ${dir.name}/photos.json: 解析失败 -`, err.message);
      continue;
    }

    if (!data.photos || data.photos.length === 0) {
      console.log(`  跳过 ${dir.name}: 没有照片`);
      continue;
    }

    // Sort photos within city by date
    const sortedPhotos = [...data.photos].sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    });

    cities.push({
      name: data.city || dir.name,
      lat: data.lat || 0,
      lng: data.lng || 0,
      photos: sortedPhotos,
    });
  }

  if (cities.length === 0) {
    console.log("未找到任何包含照片的城市目录");
    // Write empty structure so the app doesn't crash
    const output = { cities: [] };
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf-8");
    console.log(`已生成空的 ${path.relative(projectRoot, outputFile)}`);
    return;
  }

  // Sort cities by earliest photo date
  cities.sort((a, b) => {
    const dateA = getEarliestDate(a.photos);
    const dateB = getEarliestDate(b.photos);
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateA.localeCompare(dateB);
  });

  const output = { cities };

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf-8");

  const totalPhotos = cities.reduce((sum, c) => sum + c.photos.length, 0);
  console.log(`\n构建完成!`);
  console.log(`  城市数: ${cities.length}`);
  console.log(`  总照片数: ${totalPhotos}`);
  console.log(`  城市顺序: ${cities.map((c) => c.name).join(" → ")}`);
  console.log(`  输出: ${path.relative(projectRoot, outputFile)}`);
}

run();
