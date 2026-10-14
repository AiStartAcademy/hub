// src/lib/auth.ts

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import prisma from "./prisma";
import { getRoles, hasRole } from "./roles";
import { logger } from "./logger";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma as any) as any,
  session: { strategy: "jwt" },
  trustHost: true,
  debug: true,
  pages: {
    signIn: "/login",
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
      checks: ["state"],
    }),
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        });

        if (!user || !user.password) return null;

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.password
        );

        if (!isValid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          roles: getRoles({ role: user.role, roles: user.roles }),
        };
      },
    }),
  ],
  callbacks: {
    async signIn() {
      // Email verification is no longer required to sign in. New users get
      // immediate access; `emailVerified` is tracked and surfaced in the profile
      // (Settings), where they can verify or resend the verification email.
      return true;
    },
    async jwt({ token, user, trigger, account }) {
      if (user) {
        token.id = (user as any).id;
        token.name = user.name;
        token.email = user.email;
        if ((user as any).role) {
          token.role = (user as any).role;
          token.roles = user.roles ?? getRoles({ role: user.role });
        } else {
          const dbUser = await prisma.user.findUnique({
            where: { id: (user as any).id },
            select: { role: true, roles: true },
          });
          token.role = dbUser?.role || "STUDENT";
          token.roles = dbUser ? getRoles(dbUser) : getRoles({ role: token.role as string });
        }
      }
      // Strip large OAuth tokens from JWT to keep cookie size small
      // These are already stored in Account table by PrismaAdapter
      delete token.access_token;
      delete token.id_token;
      delete token.refresh_token;
      if (trigger === "update" && token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { role: true, roles: true },
        });
        if (dbUser) {
          token.role = dbUser.role;
          token.roles = getRoles(dbUser);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = token.role;
        session.user.roles = (token.roles as string[] | undefined) ?? getRoles({ role: token.role as string });
        (session.user as any).id = token.id;
        session.user.name = token.name;
        session.user.email = token.email as string;
      }
      return session;
    },
  },
  logger: {
    error(error: any) {
      logger.error("[AUTH ERROR]", error.message || error, JSON.stringify(error, null, 2));
    },
    warn(code: any) {
      console.warn("[AUTH WARN]", code);
    },
  },
});

// v1: view/edit of other users' profile data is ADMIN-only. Kept as two separate
// helpers (rather than one) so a future granular-permissions model can diverge
// them without touching call sites — see docs/features/HUMANS.md.
export function canViewUserData(session: { user?: { role?: string; roles?: string[] } } | null): boolean {
  return hasRole(session?.user, "ADMIN");
}

export function canEditUserData(session: { user?: { role?: string; roles?: string[] } } | null): boolean {
  return hasRole(session?.user, "ADMIN");
}
