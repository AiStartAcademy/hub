import type { Metadata } from "next";

import { brand } from "@/config/brand";

export const metadata: Metadata = {
  title: "Create Account",
  description: `Create your ${brand.name} learning hub account.`,
  robots: { index: false, follow: false },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
