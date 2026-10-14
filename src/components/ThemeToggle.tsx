"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export default function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme, resolvedTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  const toggle = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  return (
    <button
      onClick={toggle}
      className="fixed bottom-5 right-5 z-50 w-11 h-11 rounded-full bg-white dark:bg-[#23284A] shadow-xl border border-[#D9DEE8] dark:border-[#2e3560] flex items-center justify-center text-[#11131D] dark:text-[#56E9EB] hover:scale-110 transition-all duration-200 hover:shadow-primary/20 hover:shadow-2xl"
      title="Toggle theme"
    >
      {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
