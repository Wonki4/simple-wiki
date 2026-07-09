import "./globals.css";

export const metadata = { title: "simple-wiki" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="mx-auto max-w-4xl px-4">{children}</body>
    </html>
  );
}
