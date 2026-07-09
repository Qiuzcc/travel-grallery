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
const atomOutputFile = path.join(publicDir, "atom.xml");

// Load VITE_SITE_URL from .env file manually (Node doesn't auto-load .env)
function loadEnvVar(key) {
  const envPath = path.join(projectRoot, ".env");
  if (!fs.existsSync(envPath)) return "";
  const content = fs.readFileSync(envPath, "utf-8");
  const match = content.match(new RegExp(`^${key}=(.+)$`, "m"));
  return match ? match[1].trim() : "";
}

// Normalize SITE_URL: remove trailing slash so BASE_PATH can be appended cleanly
const rawSiteUrl = loadEnvVar("VITE_SITE_URL");
const SITE_URL = rawSiteUrl ? rawSiteUrl.replace(/\/$/, "") : "";
const BASE_PATH = "/gallery/";

function escapeXml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toISODate(dateStr) {
  if (!dateStr) return new Date().toISOString();
  // Handle "YYYY-MM-DD HH:mm" or "YYYY-MM-DD"
  const normalized = dateStr.replace(" ", "T");
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function generateAtomFeed(cities) {
  const now = new Date().toISOString();
  // SITE_URL already contains the base path (e.g. https://example.com/gallery), so don't append BASE_PATH again
  const siteUrl = SITE_URL ? SITE_URL.replace(/\/?$/, '/') : BASE_PATH;
  const selfUrl = siteUrl + 'atom.xml';

  const entries = cities
    .map((city) => {
      const earliest = getEarliestDate(city.photos);
      const latest = city.photos
        .map((p) => p.date)
        .filter((d) => d && d !== "")
        .sort()
        .pop();
      const photoCount = city.photos.length;
      const updated = toISODate(earliest);
      const cityUrl = `${siteUrl}#city=${encodeURIComponent(city.name)}`;
      const entryId = `tag:moto-gallery,2026:${encodeURIComponent(city.name)}`;

      // Pick the first photo with a valid thumbnail as cover
      const coverPhoto = city.photos.find((p) => p.thumbnail) || city.photos[0];
      const coverUrl = (() => {
        if (!coverPhoto) return "";
        const photoPath = coverPhoto.thumbnail || coverPhoto.src;
        // photoPath starts with /gallery/..., strip it since SITE_URL already contains the base path
        if (SITE_URL) {
          const relativePath = photoPath.replace(/^\/gallery\//, '');
          return `${SITE_URL}/${relativePath}`;
        }
        return photoPath;
      })();

      // Build content with image and link
      const contentLines = [
        `<p>${escapeXml(`在${city.name}拍摄了 ${photoCount} 张照片${earliest ? `，时间从 ${earliest}${latest && latest !== earliest ? ` 到 ${latest}` : ""}` : ""}。`)}</p>`,
      ];
      if (coverUrl) {
        contentLines.push(`<p><img src="${escapeXml(coverUrl)}" alt="${escapeXml(city.name)}" /></p>`);
      }
      contentLines.push(`<p><a href="${escapeXml(cityUrl)}">查看原文</a></p>`);
      const content = contentLines.join("\n      ");

      return `  <entry>
    <title>${escapeXml(`抵达${city.name}`)}</title>
    <link href="${escapeXml(cityUrl)}" />
    <updated>${updated}</updated>
    <summary>${escapeXml(`在${city.name}拍摄了 ${photoCount} 张照片。`)}</summary>
    <content type="html">
      ${content}
    </content>
    <id>${escapeXml(entryId)}</id>
  </entry>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>摩旅影像</title>
  <link href="${escapeXml(siteUrl)}" />
  <link rel="self" href="${escapeXml(selfUrl)}" />
  <updated>${now}</updated>
  <author>
    <name>摩旅影像</name>
  </author>
  <id>tag:moto-gallery,2026:feed</id>
${entries}
</feed>`;
}

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

  // Generate Atom feed
  const atomFeed = generateAtomFeed(cities);
  fs.writeFileSync(atomOutputFile, atomFeed, "utf-8");

  const totalPhotos = cities.reduce((sum, c) => sum + c.photos.length, 0);
  console.log(`\n构建完成!`);
  console.log(`  城市数: ${cities.length}`);
  console.log(`  总照片数: ${totalPhotos}`);
  console.log(`  城市顺序: ${cities.map((c) => c.name).join(" → ")}`);
  console.log(`  输出: ${path.relative(projectRoot, outputFile)}`);
  console.log(`  Atom: ${path.relative(projectRoot, atomOutputFile)}`);
}

run();
