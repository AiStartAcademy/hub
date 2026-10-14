import type { Metadata } from "next";

import { brand } from "@/config/brand";

export const metadata: Metadata = {
  title: "Sign In",
  description: `Sign in to your ${brand.name} learning hub account.`,
  robots: { index: false, follow: false },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
