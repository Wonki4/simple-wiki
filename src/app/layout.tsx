import "./globals.css";
import { IBM_Plex_Mono } from "next/font/google";
import { Header } from "@/components/Header";

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata = { title: "simple-wiki" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={plexMono.variable}>
      <body>
        <Header />
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
