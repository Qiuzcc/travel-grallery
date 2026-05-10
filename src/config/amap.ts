// 高德地图配置
// 申请地址: https://console.amap.com/dev/key/app
// 选择「Web端(JS API)」类型
// 在 .env 文件中配置 VITE_AMAP_KEY=你的Key
const key = import.meta.env.VITE_AMAP_KEY;
const securityCode = import.meta.env.VITE_AMAP_SECURITY_CODE;

if (!key) {
  console.error(
    "[AMap] 缺少环境变量 VITE_AMAP_KEY，请在 .env 文件中配置高德地图 API Key",
  );
}

// 高德地图 JS API 2.0 安全密钥配置（2021年12月后创建的key必须配置）
if (securityCode) {
  (window as any)._AMapSecurityConfig = {
    securityJsCode: securityCode,
  };
}

export const AMAP_CONFIG = {
  key: key || "",
  version: "2.0",
  plugins: ["AMap.Scale", "AMap.ToolBar"],
};
