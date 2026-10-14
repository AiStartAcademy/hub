// src/app/login/page.tsx
//
// Server shell for the login screen. Its only job is to read the two counts the
// marketing panel shows, so those numbers are real rather than hardcoded.
//
// This page is unauthenticated, so the numbers are public by definition. Only
// non-sensitive aggregates belong here — no revenue, no per-cohort breakdown,
// no names.

import prisma from "@/lib/prisma";
import LoginClient, { type LoginStats } from "./LoginClient";

// The counts move slowly and this is the busiest unauthenticated page in the
// app — revalidate hourly rather than hitting the database on every render.
export const revalidate = 3600;

async function getLoginStats(): Promise<LoginStats> {
  try {
    const [students, courses] = await Promise.all([
      prisma.user.count({ where: { enrollments: { some: {} } } }),
      prisma.program.count({ where: { status: "open" } }),
    ]);
    return { students, courses };
  } catch {
    // The login form must render even if the database is unreachable —
    // failing to sign in because a decorative stat failed would be absurd.
    return { students: 0, courses: 0 };
  }
}

export default async function LoginPage() {
  const stats = await getLoginStats();
  return <LoginClient stats={stats} />;
}
