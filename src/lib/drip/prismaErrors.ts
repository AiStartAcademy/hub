import { Prisma } from "@/generated/client";

const UNIQUE_CONSTRAINT_CODE = "P2002";

/**
 * True only for Prisma's unique-constraint violation (P2002).
 *
 * Recognises both a real `PrismaClientKnownRequestError` and any error object
 * carrying `code`, so a client instance from a different module realm (test
 * doubles, duplicated @prisma/client copies) is still classified correctly.
 * Everything else — connection errors, FK violations, validation errors — is
 * deliberately NOT matched, so callers rethrow it.
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === UNIQUE_CONSTRAINT_CODE;
  }
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_CONSTRAINT_CODE
  );
}
