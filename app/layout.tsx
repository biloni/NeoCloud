import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { PersonaProvider } from "@/components/PersonaProvider";

export const metadata: Metadata = {
  title: "NeoCloud People OS",
  description: "People operations & workforce planning — take-home exercise",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <PersonaProvider>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <div className="flex flex-1 flex-col overflow-hidden">
              <TopBar />
              <main className="flex-1 overflow-y-auto scrollbar-thin p-6">{children}</main>
            </div>
          </div>
        </PersonaProvider>
      </body>
    </html>
  );
}
