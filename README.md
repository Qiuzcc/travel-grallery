# Moto Gallery - 摩旅影像记录

摩旅照片画廊应用，展示骑行旅途中拍摄的照片。支持按城市分组展示、高德地图骑行路线可视化、照片灯箱浏览等功能。

## 技术栈

- React 18 + TypeScript + Vite
- TailwindCSS
- 高德地图 JS API 2.0
- 阿里云 OSS（部署）

## 项目结构

```
public/gallery/        # 按城市分组的原始照片及 photos.json
scripts/
  auto-divide.mjs    # 照片自动按县区分类脚本
  extract-exif.mjs    # EXIF 数据提取 + 缩略图生成脚本
  build-data.mjs      # 照片数据聚合脚本（dev/build 前自动执行）
  deploy-oss.mjs      # 阿里云 OSS 增量部署脚本
src/
  components/         # React 组件（MapView, PhotoGallery, Lightbox 等）
  config/amap.ts      # 高德地图配置
  data/               # 照片数据（generated-photos.json 由脚本生成）
```

## 环境配置

复制 `.env.example` 为 `.env` 并填写实际值：

```bash
cp .env.example .env
```

### 环境变量说明

| 变量                      | 用途                                              | 必须             |
| ------------------------- | ------------------------------------------------- | ---------------- |
| `VITE_AMAP_KEY`           | 高德地图 JS API Key（Web端类型）                  | 是               |
| `VITE_AMAP_SECURITY_CODE` | 高德地图安全密钥（2021.12 后创建的 Key 必须配置） | 是               |
| `VITE_AMAP_REST_API_KEY`  | 高德 REST API Key（Web服务类型，用于逆地理编码）  | 提取 EXIF 时需要 |
| `OSS_REGION`              | 阿里云 OSS 地域（如 `oss-cn-beijing`）            | 部署时需要       |
| `OSS_BUCKET`              | OSS Bucket 名称                                   | 部署时需要       |
| `OSS_ACCESS_KEY_ID`       | 阿里云 AccessKey ID                               | 部署时需要       |
| `OSS_ACCESS_KEY_SECRET`   | 阿里云 AccessKey Secret                           | 部署时需要       |
| `OSS_PREFIX`              | OSS 上传路径前缀（末尾带 `/`）                    | 部署时需要       |

高德 Key 申请地址: https://console.amap.com/dev/key/app

> **注意**: `.env` 文件包含敏感信息，已被 `.gitignore` 忽略，请勿提交到版本库。

## 使用方式

### 安装依赖

```bash
npm install
```

### 自动按县区分类照片

将未分类的照片放入 `public/gallery/auto-divide/` 目录，运行：

```bash
npm run auto-divide
```

脚本会自动：

- 扫描 `auto-divide/` 下所有图片（jpg/jpeg/png/heic）
- 从 EXIF 中提取 GPS 坐标
- 通过高德逆地理编码 API 获取县区级行政区名称
- 在 `public/gallery/` 下以县区全称创建目录（已存在则跳过）
- 将照片移动到对应县区目录
- 无 GPS 信息的照片移至 `public/gallery/no-exif/`

> 需要配置 `VITE_AMAP_REST_API_KEY` 或 `AMAP_WEB_SERVICE_KEY`。

### 添加照片并提取 EXIF 数据

1. 将照片放入 `public/gallery/<城市名>/` 目录
2. 运行 EXIF 提取脚本：

```bash
npm run exif -- public/gallery/城市名
```

脚本会自动：

- 扫描目录下所有图片（jpg/jpeg/png/heic）
- 提取 GPS 坐标和拍摄时间
- 生成 400px 宽缩略图到 `thumbnails/` 子目录
- 通过高德逆地理编码 API 将坐标转为地名（需配置 `VITE_AMAP_REST_API_KEY`）
- 生成/更新该城市目录的 `photos.json`

城市坐标生成逻辑：优先调用高德地理编码 API 获取城市中心坐标，API 不可用时回退到照片 GPS 点平均值。

### 本地开发

```bash
npm run dev
```

启动前会自动执行 `build-data.mjs`，聚合所有城市的 `photos.json` 为 `src/data/generated-photos.json`。

### 构建

```bash
npm run build
```

产物输出到 `dist/gallery/`。

### 部署到阿里云 OSS

```bash
# 预览变更（不实际上传）
npm run deploy:dry

# 执行增量上传
npm run deploy
```

部署脚本会对比本地 `.oss-manifest.json`，仅上传新增或变更的文件。
