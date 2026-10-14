import { NextRequest } from "next/server";
import { Prisma } from "@/generated/client";

import { syncVenueEventToGcal } from "@/lib/googleCalendar";
import { logger } from "@/lib/logger";
import {
  MCP_DETAIL_MAX_BYTES,
  MCP_LIST_MAX_BYTES,
  mcpError,
  mcpJsonLimited,
  mcpWritesEnabled,
  parseMcpPagination,
  requireMcpToken,
} from "@/lib/mcpApi";
import prisma from "@/lib/prisma";
import { slugify } from "@/lib/slug";
import {
  serializeAgenda,
  serializeFaq,
  serializeGallery,
  serializeHosts,
  serializePricingTiers,
  normalizeVideoUrl,
} from "@/lib/venueEventContent";
import { VENUE_EVENT_TYPE_SET } from "@/lib/venueEventTypeLabels";

export const dynamic = "force-dynamic";

const EVENT_STATUSES = new Set([
  "PENDING",
  "APPROVED",
  "DECLINED",
  "CANCELLED",
]);

const EVENT_LIST_STATUSES = new Set([
  "ALL",
  "PENDING",
  "APPROVED",
  "DECLINED",
  "CANCELLED",
]);

const DEAL_TYPES = new Set([
  "PAID_RENTAL",
  "BARTER",
  "REVENUE_SHARE",
  "FREE_PROMO",
  "INTERNAL",
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_12H_RE = /^(1[0-2]|[1-9]):[0-5][0-9] (AM|PM)$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GET_QUERY_KEYS = new Set([
  "id",
  "slug",
  "registrations",
  "status",
  "from",
  "to",
  "q",
  "page",
  "pageSize",
]);

const VENUE_EVENT_GET_SELECT = {
  id: true,
  title: true,
  slug: true,
  type: true,
  description: true,
  subtitle: true,
  organizerName: true,
  orgName: true,
  contactEmail: true,
  contactPhone: true,
  date: true,
  endDate: true,
  startTime: true,
  endTime: true,
  timezone: true,
  expectedAttendees: true,
  capacity: true,
  status: true,
  dealType: true,
  dealNote: true,
  adminNote: true,
  quoteAmountCents: true,
  quoteNote: true,
  rentalFeeCents: true,
  rentalDepositCents: true,
  rentalPaymentLinkId: true,
  rentalPaymentUrl: true,
  rentalPaymentStatus: true,
  cover: true,
  videoUrl: true,
  externalRegistrationUrl: true,
  ticketPriceCents: true,
  ticketPaymentLink: true,
  priceNote: true,
  gallery: true,
  agenda: true,
  hosts: true,
  pricingTiers: true,
  faq: true,
  isOnline: true,
  source: true,
  gcalEventId: true,
  gcalSyncError: true,
  gcalSyncedAt: true,
  contactId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.VenueEventSelect;

const CREATE_KEYS = new Set([
  "title",
  "type",
  "date",
  "startTime",
  "endTime",
  "organizerName",
  "contactEmail",
  "slug",
  "description",
  "subtitle",
  "orgName",
  "contactPhone",
  "timezone",
  "expectedAttendees",
  "capacity",
  "dealType",
  "dealNote",
  "adminNote",
  "quoteAmountCents",
  "quoteNote",
  "cover",
  "videoUrl",
  "externalRegistrationUrl",
  "ticketPriceCents",
  "ticketPaymentLink",
  "priceNote",
  "gallery",
  "agenda",
  "hosts",
  "pricingTiers",
  "faq",
  "isOnline",
  "status",
  "endDate",
]);

const UPDATE_KEYS = new Set([
  "id",
  "slug",
  "title",
  "description",
  "subtitle",
  "type",
  "date",
  "endDate",
  "startTime",
  "endTime",
  "timezone",
  "organizerName",
  "orgName",
  "contactEmail",
  "contactPhone",
  "expectedAttendees",
  "capacity",
  "status",
  "dealType",
  "dealNote",
  "adminNote",
  "quoteAmountCents",
  "quoteNote",
  "cover",
  "videoUrl",
  "externalRegistrationUrl",
  "ticketPriceCents",
  "ticketPaymentLink",
  "priceNote",
  "gallery",
  "agenda",
  "hosts",
  "pricingTiers",
  "faq",
  "isOnline",
]);

type JsonRecord = Record<string, unknown>;
type SyncResult = Awaited<ReturnType<typeof syncVenueEventToGcal>>;

class RouteError extends Error {
  status: number;
  context: JsonRecord;

  constructor(status: number, message: string, context: JsonRecord = {}) {
    super(message);
    this.status = status;
    this.context = context;
  }
}

function isPlainObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(status: number, message: string, context: JsonRecord = {}): never {
  throw new RouteError(status, message, context);
}

function assertAllowedKeys(
  source: JsonRecord,
  allowedKeys: Set<string>,
  label: "body" | "query",
): void {
  for (const key of Object.keys(source)) {
    if (!allowedKeys.has(key)) {
      fail(400, `Unknown ${label} key \`${key}\``, { key, label });
    }
  }
}

function normalizeRequiredString(source: JsonRecord, key: string): string {
  const value = source[key];
  if (typeof value !== "string") {
    fail(400, `Bad body field \`${key}\`: expected a string`, { key, value });
  }

  const trimmed = value.trim();
  if (!trimmed) {
    fail(400, `Bad body field \`${key}\`: cannot be empty`, { key, value });
  }

  return trimmed;
}

function normalizeOptionalString(
  source: JsonRecord,
  key: string,
  options: { allowNull?: boolean; allowEmpty?: boolean } = {},
): string | null | undefined {
  if (!(key in source)) {
    return undefined;
  }

  const value = source[key];
  if (value === null) {
    if (options.allowNull) {
      return null;
    }
    fail(400, `Bad body field \`${key}\`: null is not allowed`, { key });
  }

  if (typeof value !== "string") {
    fail(400, `Bad body field \`${key}\`: expected a string`, { key, value });
  }

  const trimmed = value.trim();
  if (!trimmed && !options.allowEmpty) {
    fail(400, `Bad body field \`${key}\`: cannot be empty`, { key, value });
  }

  return trimmed;
}

function normalizeOptionalInteger(
  source: JsonRecord,
  key: string,
  options: { allowNull?: boolean; min?: number } = {},
): number | null | undefined {
  if (!(key in source)) {
    return undefined;
  }

  const value = source[key];
  if (value === null) {
    if (options.allowNull) {
      return null;
    }
    fail(400, `Bad body field \`${key}\`: null is not allowed`, { key });
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(400, `Bad body field \`${key}\`: expected an integer`, { key, value });
  }

  if (options.min !== undefined && value < options.min) {
    fail(400, `Bad body field \`${key}\`: must be at least ${options.min}`, {
      key,
      value,
    });
  }

  return value;
}

function normalizeOptionalBoolean(
  source: JsonRecord,
  key: string,
): boolean | undefined {
  if (!(key in source)) {
    return undefined;
  }

  const value = source[key];
  if (typeof value !== "boolean") {
    fail(400, `Bad body field \`${key}\`: expected a boolean`, { key, value });
  }

  return value;
}

function normalizeEnumValue(
  value: unknown,
  key: string,
  validValues: ReadonlySet<string>,
  sourceLabel: "body field" | "query param",
): string {
  if (typeof value !== "string") {
    fail(400, `Bad ${sourceLabel} \`${key}\`: expected a string`, { key, value });
  }

  if (!validValues.has(value)) {
    fail(
      400,
      `Bad ${sourceLabel} \`${key}\`: expected one of ${Array.from(validValues).join(", ")}`,
      { key, value },
    );
  }

  return value;
}

function normalizeDateString(value: unknown, key: string, sourceLabel: "body field" | "query param"): string {
  if (typeof value !== "string") {
    fail(400, `Bad ${sourceLabel} \`${key}\`: expected YYYY-MM-DD`, { key, value });
  }

  if (!DATE_RE.test(value)) {
    fail(400, `Bad ${sourceLabel} \`${key}\`: expected YYYY-MM-DD`, { key, value });
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    fail(400, `Bad ${sourceLabel} \`${key}\`: invalid date`, { key, value });
  }

  return value;
}

function dateFromYmd(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function normalizeOptionalDate(source: JsonRecord, key: string): Date | null | undefined {
  if (!(key in source)) {
    return undefined;
  }

  const value = source[key];
  if (value === null) {
    return null;
  }

  return dateFromYmd(normalizeDateString(value, key, "body field"));
}

function normalizeTimeString(source: JsonRecord, key: string): string {
  const value = normalizeRequiredString(source, key);
  if (!TIME_12H_RE.test(value)) {
    fail(400, `Bad body field \`${key}\`: expected a 12-hour time like 6:00 PM`, {
      key,
      value,
    });
  }
  return value;
}

function normalizeOptionalTimeString(source: JsonRecord, key: string): string | undefined {
  const value = normalizeOptionalString(source, key);
  if (value === undefined) {
    return undefined;
  }
  if (value === null || !TIME_12H_RE.test(value)) {
    fail(400, `Bad body field \`${key}\`: expected a 12-hour time like 6:00 PM`, {
      key,
      value,
    });
  }
  return value;
}

function normalizeEmailString(source: JsonRecord, key: string, required: boolean): string | undefined {
  const value = required ? normalizeRequiredString(source, key) : normalizeOptionalString(source, key);
  if (value === undefined) {
    return undefined;
  }
  if (value === null || !EMAIL_RE.test(value)) {
    fail(400, `Bad body field \`${key}\`: expected a valid email address`, {
      key,
      value,
    });
  }
  return value;
}

function normalizeQueryString(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key);
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    fail(400, `Bad query param \`${key}\`: cannot be empty`, { key, value });
  }
  return trimmed;
}

function normalizeOptionalBodyEnum(
  source: JsonRecord,
  key: string,
  validValues: Set<string>,
  options: { allowNull?: boolean } = {},
): string | null | undefined {
  if (!(key in source)) {
    return undefined;
  }

  const value = source[key];
  if (value === null) {
    if (options.allowNull) {
      return null;
    }
    fail(400, `Bad body field \`${key}\`: null is not allowed`, { key });
  }

  return normalizeEnumValue(value, key, validValues, "body field");
}

/**
 * `videoUrl` accepts only a URL the page can actually embed, so the stored
 * value always matches what renders — and `javascript:`/`data:` URLs can never
 * be persisted. See normalizeVideoUrl in src/lib/venueEventContent.ts.
 */
function normalizeOptionalVideoUrl(
  source: JsonRecord,
  key: string,
): string | null | undefined {
  if (!(key in source)) {
    return undefined;
  }

  const value = source[key];
  if (value !== null && typeof value !== "string") {
    fail(400, `Bad body field \`${key}\`: expected a string or null`, { key, value });
  }

  try {
    return normalizeVideoUrl(value);
  } catch (error) {
    fail(400, `Bad body field \`${key}\`: ${(error as Error).message}`, { key, value });
  }
}

function normalizeOptionalJsonContent(
  source: JsonRecord,
  key: string,
  serialize: (value: unknown) => string | null,
): string | null | undefined {
  if (!(key in source)) {
    return undefined;
  }

  const value = source[key];
  if (value !== null && !Array.isArray(value) && typeof value !== "string") {
    fail(400, `Bad body field \`${key}\`: expected an array or a JSON string`, { key, value });
  }

  return serialize(value);
}

function didSyncFail(result: SyncResult): boolean {
  return result.outcome === "failed";
}

async function safeSyncVenueEvent(venueEventId: string): Promise<SyncResult | null> {
  try {
    const result = await syncVenueEventToGcal(venueEventId);
    if (didSyncFail(result)) {
      logger.error(
        { venueEventId, syncResult: result },
        "venue event Google Calendar sync failed",
      );
    }
    return result;
  } catch (err) {
    logger.error({ err, venueEventId }, "venue event Google Calendar sync threw");
    return null;
  }
}

async function parseJsonBody(req: NextRequest): Promise<JsonRecord> {
  let body: unknown;

  try {
    body = await req.json();
  } catch (err) {
    logger.error({ err }, "failed to parse venue event request JSON");
    fail(400, "Invalid JSON body");
  }

  if (!isPlainObject(body)) {
    fail(400, "Request body must be a JSON object");
  }

  return body;
}

async function findVenueEventByIdentity(identity: { id?: string; slug?: string }) {
  if (identity.id) {
    return prisma.venueEvent.findUnique({
      where: { id: identity.id },
      select: VENUE_EVENT_GET_SELECT,
    });
  }

  if (identity.slug) {
    return prisma.venueEvent.findUnique({
      where: { slug: identity.slug },
      select: VENUE_EVENT_GET_SELECT,
    });
  }

  fail(400, "Either `id` or `slug` is required");
}

async function resolveUniqueSlug(title: string, providedSlug?: string): Promise<string> {
  const requestedRoot = providedSlug ? slugify(providedSlug) : slugify(title);
  const root = requestedRoot || "venue-event";

  if (providedSlug && !requestedRoot) {
    fail(400, "Bad body field `slug`: slug is empty after normalization", {
      slug: providedSlug,
    });
  }

  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const candidate = attempt === 1 ? root : `${root}-${attempt}`;
    const existing = await prisma.venueEvent.findUnique({ where: { slug: candidate } });
    if (!existing) {
      return candidate;
    }
  }

  return `${root}-${Date.now()}`;
}

function handleRouteError(err: unknown, operation: string) {
  if (err instanceof RouteError) {
    logger.error({ err, ...err.context, operation }, `venue events ${operation} failed`);
    return mcpError(err.message, err.status);
  }

  logger.error({ err, operation }, `venue events ${operation} failed unexpectedly`);
  return mcpError("Internal server error", 500);
}

export async function GET(req: NextRequest) {
  const denied = await requireMcpToken(req);
  if (denied) {
    return denied;
  }

  try {
    const url = new URL(req.url);
    const params = url.searchParams;
    const queryEntries = Object.fromEntries(params.entries());
    assertAllowedKeys(queryEntries, GET_QUERY_KEYS, "query");

    const id = normalizeQueryString(params, "id");
    const slug = normalizeQueryString(params, "slug");
    const registrationsRaw = params.get("registrations");
    const statusRaw = params.get("status");
    const fromRaw = params.get("from");
    const toRaw = params.get("to");
    const q = normalizeQueryString(params, "q");

    if (id && slug) {
      fail(400, "Bad query param `slug`: provide either `id` or `slug`, not both", {
        id,
        slug,
      });
    }

    let registrations = false;
    if (registrationsRaw !== null) {
      if (registrationsRaw !== "true" && registrationsRaw !== "false") {
        fail(400, "Bad query param `registrations`: expected `true` or `false`", {
          registrations: registrationsRaw,
        });
      }
      registrations = registrationsRaw === "true";
    }

    let status = "ALL";
    if (statusRaw !== null) {
      status = normalizeEnumValue(
        statusRaw,
        "status",
        EVENT_LIST_STATUSES,
        "query param",
      );
    }

    const from = fromRaw === null ? undefined : normalizeDateString(fromRaw, "from", "query param");
    const to = toRaw === null ? undefined : normalizeDateString(toRaw, "to", "query param");

    if (from && to && from > to) {
      fail(400, "Bad query param `to`: must be on or after `from`", { from, to });
    }

    if (registrations && !id && !slug) {
      fail(400, "Bad query param `registrations`: requires `id` or `slug`", {
        registrations: registrationsRaw,
      });
    }

    if (id || slug) {
      const event = await findVenueEventByIdentity({ id, slug });
      if (!event) {
        fail(404, "Venue event not found", { id, slug });
      }

      if (registrations) {
        const registrationRows = await prisma.venueEventRegistration.findMany({
          where: { venueEventId: event.id },
          orderBy: { createdAt: "asc" },
        });

        return mcpJsonLimited(
          {
            event: {
              id: event.id,
              slug: event.slug,
              title: event.title,
            },
            registrations: registrationRows,
          },
          MCP_DETAIL_MAX_BYTES,
        );
      }

      return mcpJsonLimited(event, MCP_DETAIL_MAX_BYTES);
    }

    const { page, pageSize, skip } = parseMcpPagination(url);
    const take = pageSize;
    const where = {
      ...(status !== "ALL" ? { status } : {}),
      ...(from || to
        ? {
            date: {
              ...(from ? { gte: dateFromYmd(from) } : {}),
              ...(to ? { lte: dateFromYmd(to) } : {}),
            },
          }
        : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q } },
              { orgName: { contains: q } },
            ],
          }
        : {}),
    };

    const [events, total] = await Promise.all([
      prisma.venueEvent.findMany({
        where,
        orderBy: { date: "asc" },
        skip,
        take,
        select: VENUE_EVENT_GET_SELECT,
      }),
      prisma.venueEvent.count({ where }),
    ]);

    return mcpJsonLimited(
      {
        events,
        page,
        pageSize,
        total,
      },
      MCP_LIST_MAX_BYTES,
    );
  } catch (err) {
    return handleRouteError(err, "GET");
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireMcpToken(req);
  if (denied) {
    return denied;
  }

  if (!(await mcpWritesEnabled())) {
    logger.error({ operation: "POST" }, "venue events POST denied because MCP writes are disabled");
    return mcpError("MCP writes are disabled", 403);
  }

  try {
    const body = await parseJsonBody(req);
    assertAllowedKeys(body, CREATE_KEYS, "body");

    const title = normalizeRequiredString(body, "title");
    const type = normalizeEnumValue(body.type, "type", VENUE_EVENT_TYPE_SET, "body field");
    const dateString = normalizeDateString(body.date, "date", "body field");
    const startTime = normalizeTimeString(body, "startTime");
    const endTime = normalizeTimeString(body, "endTime");
    const organizerName = normalizeRequiredString(body, "organizerName");
    const contactEmail = normalizeEmailString(body, "contactEmail", true);
    const providedStatus = normalizeOptionalBodyEnum(body, "status", EVENT_STATUSES);
    const providedSlug = normalizeOptionalString(body, "slug");
    const resolvedSlug = await resolveUniqueSlug(title, providedSlug ?? undefined);

    const created = await prisma.venueEvent.create({
      data: {
        title,
        slug: resolvedSlug,
        type,
        date: dateFromYmd(dateString),
        endDate: normalizeOptionalDate(body, "endDate"),
        startTime,
        endTime,
        organizerName,
        contactEmail: contactEmail!,
        description: normalizeOptionalString(body, "description", { allowNull: true }),
        subtitle: normalizeOptionalString(body, "subtitle", { allowNull: true }),
        orgName: normalizeOptionalString(body, "orgName", { allowNull: true }),
        contactPhone: normalizeOptionalString(body, "contactPhone", { allowNull: true }),
        // `timezone` is a non-nullable column with a default, so an explicit null is
        // not a valid create value — fall back to the column default instead.
        timezone: normalizeOptionalString(body, "timezone") ?? undefined,
        expectedAttendees: normalizeOptionalInteger(body, "expectedAttendees", {
          allowNull: true,
          min: 0,
        }),
        capacity: normalizeOptionalInteger(body, "capacity", {
          allowNull: true,
          min: 0,
        }),
        status: providedStatus ?? "APPROVED",
        // Non-nullable column with a PAID_RENTAL default — an explicit null means
        // "leave the default", not "store null".
        dealType:
          normalizeOptionalBodyEnum(body, "dealType", DEAL_TYPES, { allowNull: true }) ??
          undefined,
        dealNote: normalizeOptionalString(body, "dealNote", { allowNull: true }),
        adminNote: normalizeOptionalString(body, "adminNote", { allowNull: true }),
        quoteAmountCents: normalizeOptionalInteger(body, "quoteAmountCents", {
          allowNull: true,
          min: 0,
        }),
        quoteNote: normalizeOptionalString(body, "quoteNote", { allowNull: true }),
        cover: normalizeOptionalString(body, "cover", { allowNull: true }),
        videoUrl: normalizeOptionalVideoUrl(body, "videoUrl"),
        externalRegistrationUrl: normalizeOptionalString(body, "externalRegistrationUrl", {
          allowNull: true,
        }),
        ticketPriceCents: normalizeOptionalInteger(body, "ticketPriceCents", {
          allowNull: true,
          min: 0,
        }),
        ticketPaymentLink: normalizeOptionalString(body, "ticketPaymentLink", {
          allowNull: true,
        }),
        priceNote: normalizeOptionalString(body, "priceNote", { allowNull: true }),
        gallery: normalizeOptionalJsonContent(body, "gallery", serializeGallery),
        agenda: normalizeOptionalJsonContent(body, "agenda", serializeAgenda),
        hosts: normalizeOptionalJsonContent(body, "hosts", serializeHosts),
        pricingTiers: normalizeOptionalJsonContent(body, "pricingTiers", serializePricingTiers),
        faq: normalizeOptionalJsonContent(body, "faq", serializeFaq),
        isOnline: normalizeOptionalBoolean(body, "isOnline"),
        source: "MCP",
      },
    });

    await safeSyncVenueEvent(created.id);

    return mcpJsonLimited(created, MCP_DETAIL_MAX_BYTES);
  } catch (err) {
    return handleRouteError(err, "POST");
  }
}

export async function PATCH(req: NextRequest) {
  const denied = await requireMcpToken(req);
  if (denied) {
    return denied;
  }

  if (!(await mcpWritesEnabled())) {
    logger.error({ operation: "PATCH" }, "venue events PATCH denied because MCP writes are disabled");
    return mcpError("MCP writes are disabled", 403);
  }

  try {
    const body = await parseJsonBody(req);
    assertAllowedKeys(body, UPDATE_KEYS, "body");

    const id = normalizeOptionalString(body, "id");
    const slug = normalizeOptionalString(body, "slug");

    if (id && slug) {
      fail(400, "Bad body field `slug`: provide either `id` or `slug`, not both", {
        id,
        slug,
      });
    }

    if (!id && !slug) {
      fail(400, "Bad body field `id`: either `id` or `slug` is required");
    }

    const existing = await findVenueEventByIdentity({ id: id ?? undefined, slug: slug ?? undefined });
    if (!existing) {
      fail(404, "Venue event not found", { id, slug });
    }

    const data: Prisma.VenueEventUpdateInput = {};
    const updateKeys = Object.keys(body).filter((key) => key !== "id" && key !== "slug");

    if (updateKeys.length === 0) {
      fail(400, "No updatable fields were provided");
    }

    if ("title" in body) {
      data.title = normalizeRequiredString(body, "title");
    }
    if ("description" in body) {
      data.description = normalizeOptionalString(body, "description", { allowNull: true });
    }
    if ("subtitle" in body) {
      data.subtitle = normalizeOptionalString(body, "subtitle", { allowNull: true });
    }
    if ("type" in body) {
      data.type = normalizeEnumValue(body.type, "type", VENUE_EVENT_TYPE_SET, "body field");
    }
    if ("date" in body) {
      data.date = dateFromYmd(normalizeDateString(body.date, "date", "body field"));
    }
    if ("endDate" in body) {
      data.endDate = normalizeOptionalDate(body, "endDate");
    }
    if ("startTime" in body) {
      data.startTime = normalizeOptionalTimeString(body, "startTime");
    }
    if ("endTime" in body) {
      data.endTime = normalizeOptionalTimeString(body, "endTime");
    }
    if ("timezone" in body) {
      // Non-nullable column with a default — reject an explicit null rather than
      // silently leaving the old value.
      const timezone = normalizeOptionalString(body, "timezone");
      if (timezone === null) {
        return mcpError("Bad body field `timezone`: null is not allowed", 400);
      }
      data.timezone = timezone;
    }
    if ("organizerName" in body) {
      data.organizerName = normalizeRequiredString(body, "organizerName");
    }
    if ("orgName" in body) {
      data.orgName = normalizeOptionalString(body, "orgName", { allowNull: true });
    }
    if ("contactEmail" in body) {
      data.contactEmail = normalizeEmailString(body, "contactEmail", false);
    }
    if ("contactPhone" in body) {
      data.contactPhone = normalizeOptionalString(body, "contactPhone", { allowNull: true });
    }
    if ("expectedAttendees" in body) {
      data.expectedAttendees = normalizeOptionalInteger(body, "expectedAttendees", {
        allowNull: true,
        min: 0,
      });
    }
    if ("capacity" in body) {
      data.capacity = normalizeOptionalInteger(body, "capacity", {
        allowNull: true,
        min: 0,
      });
    }
    if ("status" in body) {
      // Non-nullable column — an explicit null is a client error, not a clear.
      const value = normalizeOptionalBodyEnum(body, "status", EVENT_STATUSES);
      if (value === null) {
        return mcpError("Bad body field `status`: null is not allowed", 400);
      }
      data.status = value;
    }
    if ("dealType" in body) {
      // Non-nullable column with a PAID_RENTAL default — an explicit null is a
      // client error, not a clear.
      const dealType = normalizeOptionalBodyEnum(body, "dealType", DEAL_TYPES, {
        allowNull: true,
      });
      if (dealType === null) {
        return mcpError("Bad body field `dealType`: null is not allowed", 400);
      }
      data.dealType = dealType;
    }
    if ("dealNote" in body) {
      data.dealNote = normalizeOptionalString(body, "dealNote", { allowNull: true });
    }
    if ("adminNote" in body) {
      data.adminNote = normalizeOptionalString(body, "adminNote", { allowNull: true });
    }
    if ("quoteAmountCents" in body) {
      data.quoteAmountCents = normalizeOptionalInteger(body, "quoteAmountCents", {
        allowNull: true,
        min: 0,
      });
    }
    if ("quoteNote" in body) {
      data.quoteNote = normalizeOptionalString(body, "quoteNote", { allowNull: true });
    }
    if ("cover" in body) {
      data.cover = normalizeOptionalString(body, "cover", { allowNull: true });
    }
    if ("videoUrl" in body) {
      data.videoUrl = normalizeOptionalVideoUrl(body, "videoUrl");
    }
    if ("externalRegistrationUrl" in body) {
      data.externalRegistrationUrl = normalizeOptionalString(body, "externalRegistrationUrl", {
        allowNull: true,
      });
    }
    if ("ticketPriceCents" in body) {
      data.ticketPriceCents = normalizeOptionalInteger(body, "ticketPriceCents", {
        allowNull: true,
        min: 0,
      });
    }
    if ("ticketPaymentLink" in body) {
      data.ticketPaymentLink = normalizeOptionalString(body, "ticketPaymentLink", {
        allowNull: true,
      });
    }
    if ("priceNote" in body) {
      data.priceNote = normalizeOptionalString(body, "priceNote", { allowNull: true });
    }
    if ("gallery" in body) {
      data.gallery = normalizeOptionalJsonContent(body, "gallery", serializeGallery);
    }
    if ("agenda" in body) {
      data.agenda = normalizeOptionalJsonContent(body, "agenda", serializeAgenda);
    }
    if ("hosts" in body) {
      data.hosts = normalizeOptionalJsonContent(body, "hosts", serializeHosts);
    }
    if ("pricingTiers" in body) {
      data.pricingTiers = normalizeOptionalJsonContent(body, "pricingTiers", serializePricingTiers);
    }
    if ("faq" in body) {
      data.faq = normalizeOptionalJsonContent(body, "faq", serializeFaq);
    }
    if ("isOnline" in body) {
      data.isOnline = normalizeOptionalBoolean(body, "isOnline");
    }

    const updated = await prisma.venueEvent.update({
      where: { id: existing.id },
      data,
    });

    const shouldSync = updateKeys.some((key) =>
      ["status", "date", "startTime", "endTime", "title"].includes(key),
    );

    const syncResult = shouldSync ? await safeSyncVenueEvent(existing.id) : null;

    return mcpJsonLimited(
      {
        event: updated,
        syncResult,
      },
      MCP_DETAIL_MAX_BYTES,
    );
  } catch (err) {
    return handleRouteError(err, "PATCH");
  }
}
