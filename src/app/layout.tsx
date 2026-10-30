// 폰트는 npm 패키지에서 번들해 앱이 직접 서빙한다 — 빌드·런타임 모두 외부 네트워크 불필요(에어갭).
// Pretendard는 유니코드 범위별로 쪼갠 dynamic subset이라 페이지에 쓰인 글자 조각만 받는다.
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./globals.css";
import { Header } from "@/components/Header";

export const metadata = { title: "simple-wiki" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <Header />
        {children}
      </body>
    </html>
  );
}
