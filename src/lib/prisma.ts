import { PrismaClient } from "../generated/client";

export { PrismaClient };

const globalForPrisma = globalThis as unknown as {
  prisma_new: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma_new ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma_new = prisma;

export default prisma;
