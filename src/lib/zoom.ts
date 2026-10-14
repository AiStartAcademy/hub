import { Readable } from 'stream';
import prisma from "@/lib/prisma";
import { uploadStreamToGCS, buildObjectKey } from "@/lib/gcs";
import { getSecret } from "@/lib/secrets";
import { propagateRecordingLink } from "@/lib/sessionLink";
import { logger } from './logger';
import { zoomRecordingsUrl } from "@/lib/zoomRecordingsUrl";

export interface ZoomOccurrence {
  occurrence_id: string;
  start_time: string;
  duration: number;
  status: string;
}

export interface ZoomMeeting {
  id: number;
  topic: string;
  agenda?: string;
  type: number;
  start_time?: string;
  duration?: number;
  timezone: string;
  join_url: string;
  occurrences?: ZoomOccurrence[];
}

export interface ZoomRecordingFile {
  id: string;
  file_type: string;
  download_url: string;
  play_duration: number; // Duration in seconds
  recording_start: string;
  recording_end: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readJsonResponse(response: Response, context: string): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${context} returned invalid JSON`, { cause: error });
  }
}

async function getZoomHostUserId(): Promise<string> {
  return (await getSecret("ZOOM_HOST_EMAIL"))?.trim() || "me";
}

/**
 * Generates an Access Token for Zoom API via Server-to-Server OAuth
 */
export async function getZoomAccessToken(): Promise<string> {
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;

  if (!accountId || !clientId || !clientSecret) {
    throw new Error("Zoom credentials are missing in Environment Variables");
  }

  const tokenUrl = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  logger.info("[Zoom API] Fetching new access token...");

  let response: Response;
  try {
    response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      cache: "no-store",
    });
  } catch (error) {
    throw new Error("Zoom access-token request failed", { cause: error });
  }

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(`[Zoom API] Failed to fetch access token: ${errorBody}`);
    throw new Error("Failed to get Zoom access token");
  }

  const data = await readJsonResponse(response, "Zoom access-token request");
  if (!isRecord(data) || typeof data.access_token !== "string" || !data.access_token.trim()) {
    throw new Error("Zoom access-token response did not include a valid access_token");
  }
  return data.access_token;
}

export const ZOOM_WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
export type ZoomWeekday = (typeof ZOOM_WEEKDAYS)[number];

/** Zoom's recurrence day codes are 1=Sun..7=Sat — NOT the same as JS's 0=Sun..6=Sat. */
function toZoomWeeklyDays(days: ZoomWeekday[]): string {
  return days.map((d) => String(ZOOM_WEEKDAYS.indexOf(d) + 1)).join(",");
}

/**
 * Counts how many of the given weekdays fall on/between firstSessionDate and
 * lastSessionDate (both inclusive, compared as calendar days — ignores time-of-day).
 *
 * Used instead of Zoom's `recurrence.end_date_time`: a live test showed a
 * correctly-set end_date_time did NOT reliably bound a weekly-multi-day
 * recurrence (16 sessions were created across 9 weeks for what should have
 * been a 4-session, 1-week range). `end_times` (an explicit occurrence count)
 * is unambiguous and is what Zoom's own recurrence UI computes internally —
 * safer to compute it ourselves than trust an open-ended date boundary again.
 */
export function countOccurrences(firstSessionDate: Date, lastSessionDate: Date, days: ZoomWeekday[]): number {
  const wanted = new Set(days.map((d) => ZOOM_WEEKDAYS.indexOf(d)));
  let count = 0;
  const cursor = new Date(
    Date.UTC(firstSessionDate.getUTCFullYear(), firstSessionDate.getUTCMonth(), firstSessionDate.getUTCDate())
  );
  const end = new Date(
    Date.UTC(lastSessionDate.getUTCFullYear(), lastSessionDate.getUTCMonth(), lastSessionDate.getUTCDate())
  );
  while (cursor.getTime() <= end.getTime()) {
    if (wanted.has(cursor.getUTCDay())) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export interface CreateZoomMeetingInput {
  topic: string;
  /** Wall-clock start of the FIRST session, e.g. "2026-08-10T18:00:00" (no offset — timezone is separate). */
  firstSessionStartLocal: string;
  /** Session length in minutes (e.g. 180 for a 6–9pm session). */
  durationMinutes: number;
  /** IANA timezone, e.g. "America/Los_Angeles". */
  timezone: string;
  /**
   * Last calendar day (inclusive) sessions occur. Used to COMPUTE an explicit
   * occurrence count (Zoom's `end_times`), not sent to Zoom as a date boundary —
   * see countOccurrences() for why.
   */
  lastSessionDate: Date;
  /**
   * Which weekdays sessions recur on — REQUIRED, no default. Cohort formats differ
   * (e.g. an evening format may run Mon–Thu, NOT Mon–Fri, while a daytime
   * intensive runs Mon–Fri) — guessing here has already produced one wrong recurrence, so the
   * caller must say explicitly rather than this function assuming a "usual" week.
   */
  days: ZoomWeekday[];
}

export interface CreatedZoomMeeting {
  id: number;
  joinUrl: string;
  startUrl: string;
  password: string | null;
}

/**
 * Creates a recurring, fixed-time Zoom meeting (Server-to-Server OAuth).
 *
 * Multi-weekday recurrence is native to the Zoom API (`weekly_days: "2,3,4,5"` for
 * Mon–Thu, Zoom's day codes are 1=Sun..7=Sat) — no manual day pruning needed, as
 * long as the caller supplies the right `days`.
 *
 * Settings follow the academy cohort standard: cloud recording on,
 * no password, no registration/approval gate, join before host allowed,
 * host + participant video on by default, participants muted on entry,
 * screen share open to everyone with multiple simultaneous shares allowed.
 * NOTE: if the Zoom account has an account-level "require passcode" policy,
 * Zoom may still assign one regardless of `password: ""` here — that's an
 * account setting, not something a single meeting-create call can override.
 */
export async function createZoomMeeting(input: CreateZoomMeetingInput): Promise<CreatedZoomMeeting> {
  const token = await getZoomAccessToken();

  if (!input.days?.length) {
    throw new Error("createZoomMeeting: days is required (e.g. ['MON','TUE','WED','THU'])");
  }
  const weeklyDays = toZoomWeeklyDays(input.days);
  // There is exactly one shared Zoom host account today (no per-instructor licenses) —
  // target it explicitly rather than relying on "me" resolving to the right account.
  const hostUserId = await getZoomHostUserId();

  const firstSessionDate = new Date(input.firstSessionStartLocal.slice(0, 10));
  const endTimes = countOccurrences(firstSessionDate, input.lastSessionDate, input.days);
  if (endTimes < 1) {
    throw new Error("createZoomMeeting: computed 0 occurrences — check firstSessionStartLocal/lastSessionDate/days");
  }
  if (endTimes > 60) {
    // Zoom's hard cap on end_times. Fail closed rather than silently truncating the schedule.
    throw new Error(
      `createZoomMeeting: computed ${endTimes} occurrences, but Zoom's end_times max is 60 — ` +
        `split this into multiple meetings or shorten the date range`
    );
  }

  const body = {
    topic: input.topic,
    type: 8, // recurring meeting with a fixed time
    start_time: input.firstSessionStartLocal,
    duration: input.durationMinutes,
    timezone: input.timezone,
    recurrence: {
      type: 2, // weekly
      repeat_interval: 1,
      weekly_days: weeklyDays,
      end_times: endTimes,
    },
    settings: {
      host_video: true,
      participant_video: true,
      join_before_host: true,
      waiting_room: false,
      mute_upon_entry: true,
      auto_recording: "cloud",
      approval_type: 2, // no registration required
      meeting_authentication: false,
      who_can_share_screen: "all_participants",
      who_can_share_screen_when_someone_is_sharing: "all_participants", // allows multiple simultaneous screen shares
    },
    password: "",
  };

  const response = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(hostUserId)}/meetings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(`[Zoom API] Failed to create meeting: ${errorBody}`);
    throw new Error(`Failed to create Zoom meeting (${response.status}): ${errorBody.slice(0, 300)}`);
  }

  const data = await response.json();
  return {
    id: data.id,
    joinUrl: data.join_url,
    startUrl: data.start_url,
    password: data.password || null,
  };
}

export interface CreateOneOffZoomMeetingInput {
  topic: string;
  startTimeIso: string;
  durationMin: number;
  timezone: string;
}

export interface CreatedOneOffZoomMeeting {
  id: number;
  joinUrl: string;
}

/** Creates one fixed-time Zoom meeting for a lead booking. */
export async function createOneOffZoomMeeting(
  input: CreateOneOffZoomMeetingInput,
): Promise<CreatedOneOffZoomMeeting> {
  const topic = input.topic.trim();
  const timezone = input.timezone.trim();
  const startTime = new Date(input.startTimeIso);

  if (!topic) {
    throw new Error("createOneOffZoomMeeting: topic is required");
  }
  if (!timezone) {
    throw new Error("createOneOffZoomMeeting: timezone is required");
  }
  if (Number.isNaN(startTime.getTime())) {
    throw new Error("createOneOffZoomMeeting: startTimeIso must be a valid ISO instant");
  }
  if (!Number.isInteger(input.durationMin) || input.durationMin < 1) {
    throw new Error("createOneOffZoomMeeting: durationMin must be a positive integer");
  }

  const token = await getZoomAccessToken();
  const hostUserId = await getZoomHostUserId();
  const body = {
    topic,
    type: 2,
    start_time: input.startTimeIso,
    duration: input.durationMin,
    timezone,
    settings: {
      join_before_host: true,
      waiting_room: false,
      approval_type: 2,
      auto_recording: "none",
    },
    password: "",
  };

  let response: Response;
  try {
    response = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(hostUserId)}/meetings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    throw new Error("Failed to create one-off Zoom meeting: request failed", { cause: error });
  }

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error({ status: response.status, errorBody }, "[Zoom API] Failed to create one-off meeting");
    throw new Error(
      `Failed to create one-off Zoom meeting (${response.status}): ${errorBody.slice(0, 300)}`,
    );
  }

  const data = await readJsonResponse(response, "One-off Zoom meeting creation");
  if (
    !isRecord(data) ||
    typeof data.id !== "number" ||
    !Number.isFinite(data.id) ||
    typeof data.join_url !== "string" ||
    !data.join_url.trim()
  ) {
    throw new Error("One-off Zoom meeting response did not include a valid id and join_url");
  }

  return { id: data.id, joinUrl: data.join_url };
}

/**
 * Deletes a Zoom meeting (the whole recurring series, including future occurrences).
 * Cleanup for test/throwaway cohorts created via createZoomMeeting — irreversible,
 * so callers should gate this behind the same dry-run/confirm discipline as writes.
 * A 404 (already gone) is treated as success, not an error — deleting twice should
 * not be surprising.
 */
export async function deleteZoomMeeting(meetingId: string): Promise<void> {
  const token = await getZoomAccessToken();

  const response = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (response.status === 404) return;
  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(`[Zoom API] Failed to delete meeting ${meetingId}: ${errorBody}`);
    throw new Error(`Failed to delete Zoom meeting ${meetingId} (${response.status}): ${errorBody.slice(0, 300)}`);
  }
}

/**
 * Extracts the numerical Meeting ID from a standard Zoom Join URL
 */
export function extractMeetingId(zoomLink: string): string | null {
  try {
    const url = new URL(zoomLink);
    if (url.pathname.includes("/j/")) {
      const parts = url.pathname.split("/");
      const idPart = parts[parts.indexOf("j") + 1];
      return idPart ? idPart.replace(/\D/g, "") : null;
    }
    return null;
  } catch (error) {
    console.warn(`[Zoom API] Invalid Zoom URL format: ${zoomLink}`);
    return null;
  }
}

/**
 * Fetches full meeting details from Zoom API, including its occurrences (schedule)
 */
export async function getMeetingDetails(meetingId: string): Promise<ZoomMeeting | null> {
  try {
    const token = await getZoomAccessToken();
    const url = `https://api.zoom.us/v2/meetings/${meetingId}?show_previous_occurrences=true`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    if (response.status === 404) {
      console.warn(`[Zoom API] Meeting ${meetingId} not found in Zoom`);
      return null;
    }

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(`[Zoom API] Failed to fetch meeting details for ${meetingId}: ${errorBody}`);
      throw new Error("Zoom API request failed");
    }

    const data = (await response.json()) as ZoomMeeting;
    return data;
  } catch (error) {
    logger.error({ err: error }, `[Zoom API] Error in getMeetingDetails:`);
    return null;
  }
}

/**
 * Fetches recording data from Zoom Cloud
 */
export async function getZoomMeetingCloudRecordings(meetingId: string, instanceUuid?: string | null): Promise<any> {
  const token = await getZoomAccessToken();
  // With instanceUuid: that specific past instance. Without: the numeric id, which
  // Zoom resolves to the LATEST instance of a recurring meeting only.
  const response = await fetch(zoomRecordingsUrl(meetingId, instanceUuid), {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store'
  });
  
  if (!response.ok) {
    if (response.status === 404) return null;
    
    const errorBody = await response.text();
    logger.error(`[Zoom API Error 400 Details]: ${errorBody}`);
    throw new Error(`[Zoom API] Failed to fetch recordings: ${response.statusText} - ${errorBody}`);
  }
  return response.json();
}

/**
 * Downloads a video from Zoom and streams it to storage via gcs.ts
 */
async function streamZoomVideoToGCS(
  downloadUrl: string, 
  objectKey: string, 
  token: string
): Promise<string> {
  const urlWithToken = `${downloadUrl}?access_token=${token}`;
  const response = await fetch(urlWithToken);
  
  if (!response.ok || !response.body) {
    throw new Error(`[Zoom] Failed to pipe video stream: ${response.statusText}`);
  }

  // Convert the fetch WebStream into a Node.js Readable stream
  const webStream = response.body as unknown as import('stream/web').ReadableStream;
  const nodeStream = Readable.fromWeb(webStream);

  // Upload via lib/gcs.ts
  const savedGcsKey = await uploadStreamToGCS(nodeStream, objectKey, 'video/mp4');
  return savedGcsKey;
}

/**
 * Imports new Zoom recordings into the archive course in chronological order
 * and links them to the matching calendar sessions (CohortSession)
 */
export async function syncRecordingsToProgram(
  meetingId: string,
  cohortId: string,
  rawProgramId: string,
  instanceUuid?: string | null,
) {
  logger.info(`[Zoom Records Sync 1] START. meetingId: ${meetingId}, instanceUuid: ${instanceUuid ?? "(latest)"}, cohortId: ${cohortId}, rawProgramId: ${rawProgramId}`);

  const recordingsData = await getZoomMeetingCloudRecordings(meetingId, instanceUuid);
  
  if (!recordingsData) {
    logger.info(`[Zoom Records Sync 2] ABORT: getZoomMeetingCloudRecordings returned null/empty (there may be no recordings at all).`);
    return;
  }
  
  if (!recordingsData.recording_files) {
    logger.info(`[Zoom Records Sync 2] ABORT: recording_files array is missing. Available keys: ${Object.keys(recordingsData)}`);
    return;
  }

  logger.info(`[Zoom Records Sync 3] Zoom returned files in total (incl. audio/chat): ${recordingsData.recording_files.length}`);

  const program = await prisma.program.findUnique({
    where: { id: rawProgramId },
    include: { modules: true }
  });
  
  if (!program) {
    console.warn(`[Zoom Records Sync 4] ABORT: Program with ID ${rawProgramId} not found in the database.`);
    return;
  }

  logger.info(`[Zoom Records Sync 5] Found program: ${program.name}. Modules: ${program.modules.length}`);

  // Find or create the "General" module
  const moduleName = "General";
  let targetModule = program.modules.find((m: any) => m.name === moduleName);
  
  if (!targetModule) {
    logger.info(`[Zoom Records Sync 6] Module 'General' not found. Creating it...`);
    const activeModulesCount = program.modules.length;
    targetModule = await prisma.module.create({
      data: {
        programId: program.id,
        name: moduleName,
        order: activeModulesCount,
      }
    });
  } else {
    logger.info(`[Zoom Records Sync 6] Module '${targetModule.name}' found. ID: ${targetModule.id}`);
  }

  logger.info(`[Zoom Records Sync 7] Screening files...`);
  const videoFiles = (recordingsData.recording_files as ZoomRecordingFile[])
    .filter(f => {
      // Compute the video length; the Zoom API does not always send play_duration
      let durationSec = f.play_duration || 0;
      if (!durationSec && f.recording_end && f.recording_start) {
        durationSec = (new Date(f.recording_end).getTime() - new Date(f.recording_start).getTime()) / 1000;
      }
      
      logger.info(`   --> Check: ID=${f.id} | Type=${f.file_type} | Computed duration=${durationSec}s`);
      
      const isMp4 = f.file_type === 'MP4';
      const isLongEnough = durationSec >= 1200; // 20 minutes
      
      if (!isMp4) logger.info(`       [rejected] not MP4`);
      else if (!isLongEnough) logger.info(`       [rejected] too short (< 1200s)`);
      else {
        logger.info(`       [accepted] Eligible for upload.`);
        // Store the computed duration on the object for the upload step
        f.play_duration = Math.floor(durationSec);
      }

      return isMp4 && isLongEnough;
    })
    .sort((a, b) => new Date(a.recording_start).getTime() - new Date(b.recording_start).getTime());

  logger.info(`[Zoom Records Sync 8] Files after filtering: ${videoFiles.length}`);

  if (videoFiles.length === 0) {
    logger.info(`[Zoom Records Sync 9] ABORT: No valid videos to process.`);
    return;
  }

  let lessonsAdded = 0;
  const zoomToken = await getZoomAccessToken();

  for (const file of videoFiles) {
    logger.info(`[Zoom Records Sync 10] Processing file ${file.id}...`);
    
    // Duplicate guard
    const existingLesson = await prisma.lesson.findUnique({ where: { zoomFileId: file.id } });
    if (existingLesson) {
      logger.info(`   -> SKIPPED: a lesson with zoomFileId ${file.id} already exists`);
      continue;
    }
    
    const recordingDateObj = new Date(file.recording_start);
    const recordingDateStr = recordingDateObj.toLocaleDateString('en-US'); 
    const lessonName = `Recording - ${recordingDateStr}`;
    
    // Safe object path for the GCS upload
    const objectKey = buildObjectKey(
      program.name,
      targetModule.name,
      lessonName,
      `zoom_${file.id}.mp4`
    );
    logger.info(`   -> Starting stream upload... Path: ${objectKey}`);

    try {
      // Stream download_url into GCS
      const gcsKey = await streamZoomVideoToGCS(file.download_url, objectKey, zoomToken);
      logger.info(`   -> Uploaded to GCS. Key: ${gcsKey}`);

      const currentLessonsCount = await prisma.lesson.count({ where: { moduleId: targetModule.id } });

      const newLesson = await prisma.lesson.create({
        data: {
          moduleId: targetModule.id,
          name: lessonName,
          type: "video",
          videoUrl: gcsKey,
          duration: file.play_duration,
          zoomFileId: file.id,
          order: currentLessonsCount,
        }
      });
      logger.info(`   -> Lesson created in DB. Lesson ID: ${newLesson.id}`);

      // Link to the calendar session
      const startOfDay = new Date(recordingDateObj);
      startOfDay.setUTCHours(0, 0, 0, 0);
      const endOfDay = new Date(recordingDateObj);
      endOfDay.setUTCHours(23, 59, 59, 999);

      const matchingSession = await prisma.cohortSession.findFirst({
        where: { cohortId: cohortId, date: { gte: startOfDay, lte: endOfDay } }
      });

      if (matchingSession) {
        const recordingLink = `/courses/${rawProgramId}/${newLesson.id}`;
        await prisma.cohortSession.update({
          where: { id: matchingSession.id },
          data: { recordingLink }
        });
        logger.info(`   -> Recording linked to the calendar session`);
        // Sessions in other cohorts that borrowed this meeting (linkedSessionId)
        // get the same recording, unless they already have their own.
        const propagated = await propagateRecordingLink(matchingSession.id, recordingLink);
        if (propagated > 0) logger.info(`   -> Recording propagated to ${propagated} linked session(s).`);
      } else {
        logger.info(`   -> Warning: no calendar session found for ${recordingDateStr}.`);
      }

      lessonsAdded++;
    } catch (err: any) {
      logger.error(`   -> File upload FAILED:`, err?.message || err);
    }
  }

  if (lessonsAdded > 0) {
    logger.info(`[Zoom Records Sync 11] DONE. Videos uploaded: ${lessonsAdded}. Updating dates...`);
    await prisma.module.update({
      where: { id: targetModule.id },
      data: { updatedAt: new Date() }
    });
    await prisma.program.update({
      where: { id: program.id },
      data: { updatedAt: new Date() }
    });
  } else {
    logger.info(`[Zoom Records Sync 11] DONE. No new videos added.`);
  }
}
/**
 * Pulls one cohort's Zoom occurrences into CohortSession rows.
 *
 * Zoom is the source of truth for the schedule: date/time/status/order are
 * overwritten on every run, and occurrences deleted in Zoom are removed here.
 * Title and description are only set on create, so hand-edits in the admin
 * panel survive subsequent syncs.
 *
 * Returns the number of occurrences synced, or null if the cohort has no
 * usable Zoom link / the meeting has no occurrences.
 */
/**
 * Clock-derived session status, matching getDynamicStatus() in the cohort ManageView so
 * the stored value agrees with what the UI renders. The stored value is a snapshot taken
 * at sync time; consumers that need exactness derive it from startTime/endTime themselves.
 */
export function sessionStatusAt(start: Date, end: Date, now: Date = new Date()): string {
  if (now > end) return "completed";
  if (now >= start) return "live";
  return "upcoming";
}

export async function syncCohortSessions(cohort: {
  id: string;
  title: string;
  zoomLink: string | null;
  rawProgramId?: string | null;
}, options: { zoomInstanceUuid?: string | null } = {}): Promise<number | null> {
  if (!cohort.zoomLink) return null;

  const meetingId = extractMeetingId(cohort.zoomLink);
  if (!meetingId) {
    console.warn(`[Zoom Sync] Could not extract meeting ID for cohort ${cohort.id}`);
    return null;
  }

  const meetingDetails = await getMeetingDetails(meetingId);
  if (!meetingDetails || !meetingDetails.occurrences) {
    logger.info(`[Zoom Sync] No occurrences found for cohort ${cohort.id}`);
    return null;
  }

  // Drop calls the instructor cancelled (including weekend ones)
  const activeOccurrences = meetingDetails.occurrences.filter((o) => o.status !== "deleted");
  logger.info(`[Zoom Sync] Syncing ${activeOccurrences.length} active sessions for cohort: ${cohort.title}`);

  // A call stored in the DB but now cancelled in Zoom is deleted
  const zoomOccurrenceIds = activeOccurrences.map((o) => o.occurrence_id);
  await prisma.cohortSession.deleteMany({
    where: { cohortId: cohort.id, zoomOccurrenceId: { notIn: zoomOccurrenceIds, not: null } },
  });

  for (const [index, occurrence] of activeOccurrences.entries()) {
    const startDate = new Date(occurrence.start_time);
    const endDate = new Date(startDate.getTime() + (occurrence.duration || 60) * 60000);

    // Store exact UTC ISO strings so the client converts them to the browser's local time
    const startTimeStr = startDate.toISOString();
    const endTimeStr = endDate.toISOString();
    // Status is derived from the clock, NOT from occurrence.status — Zoom's occurrence
    // status is only "available" | "deleted" (i.e. scheduled vs cancelled) and says nothing
    // about whether the session has happened. Deleted occurrences are filtered out above.
    const sessionStatus = sessionStatusAt(startDate, endDate);

    await prisma.cohortSession.upsert({
      // Compound key (cohortId + zoomOccurrenceId), not zoomOccurrenceId alone — Zoom's
      // occurrence_id is an epoch timestamp, which two different meetings can share if
      // their schedules coincide. A bare-unique key let one cohort's sync silently steal
      // another cohort's session row in that case.
      where: { cohortId_zoomOccurrenceId: { cohortId: cohort.id, zoomOccurrenceId: occurrence.occurrence_id } },
      create: {
        cohortId: cohort.id,
        // Stable, date-free title — the UI formats date/time per viewer.
        title: `Session ${index + 1}`,
        description: meetingDetails.agenda || null,
        date: startDate,
        startTime: startTimeStr,
        endTime: endTimeStr,
        timezone: meetingDetails.timezone || "UTC",
        status: sessionStatus,
        meetingLink: cohort.zoomLink,
        zoomOccurrenceId: occurrence.occurrence_id,
        order: index,
      },
      update: {
        date: startDate,
        startTime: startTimeStr,
        endTime: endTimeStr,
        timezone: meetingDetails.timezone || "UTC",
        status: sessionStatus,
        order: index,
      },
    });
  }

  if (cohort.rawProgramId) {
    // Sessions are upserted above first, so a backfilled instance still finds its
    // same-UTC-day CohortSession for the recordingLink step.
    await syncRecordingsToProgram(meetingId, cohort.id, cohort.rawProgramId, options.zoomInstanceUuid);
  }

  return activeOccurrences.length;
}
