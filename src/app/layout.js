import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata = {
  title: {
    default: "ScenarioShare",
    template: "%s | ScenarioShare",
  },
  description: "METARMO와 Plazma가 함께 만드는 실시간 시나리오 위키",
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
