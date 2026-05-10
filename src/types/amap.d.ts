declare module "@amap/amap-jsapi-loader" {
  interface LoadOptions {
    key: string;
    version: string;
    plugins?: string[];
  }

  interface AMapLoader {
    load(options: LoadOptions): Promise<any>;
    reset(): void;
  }

  const loader: AMapLoader;
  export default loader;
}
