import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata = {
  title: {
    default: "ScenarioShare",
    template: "%s | ScenarioShare",
  },
  description: "비공개 실시간 시나리오 위키와 협업 편집기",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>
        <Analytics />
        {children}
      </body>
    </html>
  );
}
