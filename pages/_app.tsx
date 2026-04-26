import "@/styles/globals.css";
import type { AppProps } from "next/app";
import Head from "next/head";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>大學職涯活動整合 | 實習通分支站</title>
        <meta
          name="description"
          content="整合各大學職涯中心的講座、工作坊、履歷健檢、企業參訪等活動,依時間排序、按類型分類。"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🎓%3C/text%3E%3C/svg%3E" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
