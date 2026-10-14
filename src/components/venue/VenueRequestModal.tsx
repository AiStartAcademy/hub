"use client";

import {
  useEffect,
  useId,
  useState,
  type ChangeEvent,
  type FormEvent,
  type JSX,
} from "react";

import { brand } from "@/config/brand";
import {
  formatLocalTime,
  parseProjectTimeToMinutes,
  projectTimeRangesOverlap,
} from "@/lib/calendarUtils";

export interface VenueDayBlock {
  label: string;
  startTime: string;
  endTime: string;
}

export interface VenueRequestModalProps {
  open: boolean;
  onClose: () => void;
  initialDate: string | null;
  dayBlocks: VenueDayBlock[];
}

type EventType =
  | "NETWORKING"
  | "HACKATHON"
  | "WORKSHOP"
  | "MEETUP"
  | "INTERVIEW"
  | "PODCAST"
  | "PANEL"
  | "DEMO_DAY"
  | "KIDS_PROGRAM"
  | "MOVIE_CLUB"
  | "OTHER";

type FormState = {
  organizerName: string;
  orgName: string;
  contactEmail: string;
  contactPhone: string;
  title: string;
  type: "" | EventType;
  date: string;
  startTime: string;
  endTime: string;
  expectedAttendees: string;
  description: string;
};

type FieldName = keyof FormState;
type FieldErrors = Partial<Record<FieldName, string>>;

type SuccessState = {
  slug: string;
  conflicts: VenueDayBlock[];
};

type ValidationResult = {
  errors: FieldErrors;
  projectStartTime: string | null;
  projectEndTime: string | null;
};

const EVENT_TYPE_OPTIONS: Array<{ value: EventType; label: string }> = [
  { value: "NETWORKING", label: "Networking" },
  { value: "HACKATHON", label: "Hackathon" },
  { value: "WORKSHOP", label: "Workshop" },
  { value: "MEETUP", label: "Meetup" },
  { value: "INTERVIEW", label: "Interview" },
  { value: "PODCAST", label: "Podcast" },
  { value: "PANEL", label: "Panel" },
  { value: "DEMO_DAY", label: "Demo Day" },
  { value: "KIDS_PROGRAM", label: "Kids Program" },
  { value: "MOVIE_CLUB", label: "Movie Club" },
  { value: "OTHER", label: "Other" },
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function buildInitialFormState(initialDate: string | null): FormState {
  return {
    organizerName: "",
    orgName: "",
    contactEmail: "",
    contactPhone: "",
    title: "",
    type: "",
    date: initialDate ?? "",
    startTime: "",
    endTime: "",
    expectedAttendees: "",
    description: "",
  };
}

export function toProjectTime(value: string): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);

  if (!match) {
    throw new Error("Time must be in HH:mm format.");
  }

  const hour24 = Number(match[1]);
  const minutes = match[2];
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

  return `${hour12}:${minutes} ${suffix}`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseErrorResponse(value: unknown): string | null {
  const objectValue = asObject(value);

  if (!objectValue || typeof objectValue.error !== "string" || !objectValue.error.trim()) {
    return null;
  }

  return objectValue.error;
}

function isVenueDayBlock(value: unknown): value is VenueDayBlock {
  const objectValue = asObject(value);

  return (
    objectValue !== null &&
    typeof objectValue.label === "string" &&
    typeof objectValue.startTime === "string" &&
    typeof objectValue.endTime === "string"
  );
}

function parseSuccessResponse(value: unknown): SuccessState | null {
  const objectValue = asObject(value);

  if (
    !objectValue ||
    objectValue.ok !== true ||
    typeof objectValue.slug !== "string" ||
    !Array.isArray(objectValue.conflicts) ||
    !objectValue.conflicts.every(isVenueDayBlock)
  ) {
    return null;
  }

  return {
    slug: objectValue.slug,
    conflicts: objectValue.conflicts,
  };
}

function validateForm(formState: FormState): ValidationResult {
  const errors: FieldErrors = {};

  if (!formState.organizerName.trim()) {
    errors.organizerName = "Organizer name is required.";
  }

  if (!formState.contactEmail.trim()) {
    errors.contactEmail = "Email is required.";
  } else if (!EMAIL_REGEX.test(formState.contactEmail.trim())) {
    errors.contactEmail = "Enter a valid email address.";
  }

  if (!formState.title.trim()) {
    errors.title = "Event title is required.";
  }

  if (!formState.type) {
    errors.type = "Event type is required.";
  }

  if (!formState.date) {
    errors.date = "Date is required.";
  }

  let projectStartTime: string | null = null;
  let projectEndTime: string | null = null;

  if (!formState.startTime) {
    errors.startTime = "Start time is required.";
  } else {
    try {
      projectStartTime = toProjectTime(formState.startTime);
    } catch {
      errors.startTime = "Enter a valid start time.";
    }
  }

  if (!formState.endTime) {
    errors.endTime = "End time is required.";
  } else {
    try {
      projectEndTime = toProjectTime(formState.endTime);
    } catch {
      errors.endTime = "Enter a valid end time.";
    }
  }

  if (projectStartTime && projectEndTime) {
    const startMinutes = parseProjectTimeToMinutes(projectStartTime);
    const endMinutes = parseProjectTimeToMinutes(projectEndTime);

    if (endMinutes <= startMinutes) {
      errors.endTime = "End time must be after start time.";
    }
  }

  if (
    formState.expectedAttendees.trim() &&
    !/^[1-9]\d*$/.test(formState.expectedAttendees.trim())
  ) {
    errors.expectedAttendees = "Expected attendees must be a positive whole number.";
  }

  return {
    errors,
    projectStartTime,
    projectEndTime,
  };
}

function getOverlappingBlocks(
  dayBlocks: VenueDayBlock[],
  startTime: string,
  endTime: string,
): VenueDayBlock[] {
  if (!startTime || !endTime) {
    return [];
  }

  try {
    const projectStartTime = toProjectTime(startTime);
    const projectEndTime = toProjectTime(endTime);

    if (
      parseProjectTimeToMinutes(projectEndTime) <=
      parseProjectTimeToMinutes(projectStartTime)
    ) {
      return [];
    }

    return dayBlocks.filter((block) =>
      projectTimeRangesOverlap(projectStartTime, projectEndTime, block.startTime, block.endTime),
    );
  } catch {
    return [];
  }
}

export default function VenueRequestModal(
  props: VenueRequestModalProps,
): JSX.Element | null {
  const { open, onClose, initialDate, dayBlocks } = props;
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();

  const [formState, setFormState] = useState<FormState>(() =>
    buildInitialFormState(initialDate),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successState, setSuccessState] = useState<SuccessState | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setFormState(buildInitialFormState(initialDate));
    setErrors({});
    setSubmitError(null);
    setIsSubmitting(false);
    setSuccessState(null);
  }, [initialDate, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  const overlappingBlocks = getOverlappingBlocks(
    dayBlocks,
    formState.startTime,
    formState.endTime,
  );

  const updateField = (name: FieldName, value: string): void => {
    setFormState((currentState) => ({
      ...currentState,
      [name]: value,
    }));

    setErrors((currentErrors) => {
      if (!(name in currentErrors)) {
        return currentErrors;
      }

      const nextErrors = { ...currentErrors };
      delete nextErrors[name];
      return nextErrors;
    });

    setSubmitError(null);
  };

  const handleChange = (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ): void => {
    const fieldName = event.target.name as FieldName;
    updateField(fieldName, event.target.value);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const validation = validateForm(formState);
    setErrors(validation.errors);
    setSubmitError(null);

    if (Object.keys(validation.errors).length > 0) {
      return;
    }

    if (!validation.projectStartTime || !validation.projectEndTime) {
      setSubmitError("Unable to prepare the selected time range.");
      return;
    }

    const payload = {
      organizerName: formState.organizerName.trim(),
      orgName: formState.orgName.trim() || undefined,
      contactEmail: formState.contactEmail.trim(),
      contactPhone: formState.contactPhone.trim() || undefined,
      title: formState.title.trim(),
      type: formState.type,
      date: formState.date,
      startTime: validation.projectStartTime,
      endTime: validation.projectEndTime,
      expectedAttendees: formState.expectedAttendees.trim()
        ? Number(formState.expectedAttendees.trim())
        : undefined,
      description: formState.description.trim() || undefined,
    };

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/public/venue-events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const responseBody: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setSubmitError(
          parseErrorResponse(responseBody) ??
            "Unable to submit your request right now. Please try again.",
        );
        return;
      }

      const parsedSuccess = parseSuccessResponse(responseBody);

      if (!parsedSuccess) {
        setSubmitError("The server returned an unexpected response.");
        return;
      }

      setSuccessState(parsedSuccess);
    } catch (error: unknown) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "A network error prevented the request from being submitted.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!open) {
    return null;
  }

  const requiredMark = <span className="ml-1 text-rose-400">*</span>;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
        className="relative w-full max-w-3xl overflow-hidden rounded-3xl border border-white/10 bg-slate-900 text-slate-100 shadow-2xl shadow-black/40"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-cyan-400"
          aria-label="Close venue request modal"
        >
          Close
        </button>

        <div className="border-b border-white/10 bg-gradient-to-r from-cyan-500/12 via-slate-900 to-emerald-500/12 px-6 py-6 sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">
            Venue Request
          </p>
          <h2 id={dialogTitleId} className="mt-2 text-2xl font-semibold text-white">
            Request the {brand.shortName} venue
          </h2>
          <p id={dialogDescriptionId} className="mt-2 max-w-2xl text-sm text-slate-300">
            Share your event details and preferred time. The team will review availability
            and follow up by email.
          </p>
        </div>

        <div className="max-h-[85vh] overflow-y-auto px-6 py-6 sm:px-8">
          <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
              What&apos;s already on this day
            </h3>
            {dayBlocks.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {dayBlocks.map((block, index) => (
                  <li
                    key={`${block.label}-${block.startTime}-${block.endTime}-${index}`}
                    className="flex flex-col gap-1 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="font-medium text-slate-100">{block.label}</span>
                    <span className="text-sm text-slate-300">
                      {formatLocalTime(block.startTime)} to {formatLocalTime(block.endTime)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-emerald-300">
                This day is currently open with no listed venue blocks.
              </p>
            )}
          </section>

          {successState ? (
            <section className="mt-6 space-y-4 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-5">
              <div>
                <h3 className="text-lg font-semibold text-emerald-200">
                  Request received
                </h3>
                <p className="mt-2 text-sm text-slate-200">
                  Your venue request is pending review. {brand.shortName} will follow up by email after
                  the team checks fit and availability.
                </p>
                <p className="mt-2 text-xs uppercase tracking-[0.18em] text-emerald-300">
                  Reference: {successState.slug}
                </p>
              </div>

              {successState.conflicts.length > 0 ? (
                <div
                  role="alert"
                  className="rounded-2xl border border-amber-400/35 bg-amber-500/10 p-4 text-sm text-amber-100"
                >
                  <p className="font-medium text-amber-200">
                    The team flagged possible conflicts for the requested day:
                  </p>
                  <ul className="mt-3 space-y-2">
                    {successState.conflicts.map((block, index) => (
                      <li
                        key={`${block.label}-${block.startTime}-${block.endTime}-${index}`}
                        className="rounded-xl border border-amber-300/15 bg-black/10 px-3 py-2"
                      >
                        {block.label}: {formatLocalTime(block.startTime)} to{" "}
                        {formatLocalTime(block.endTime)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : (
            <form className="mt-6 space-y-5" onSubmit={handleSubmit} noValidate>
              {submitError ? (
                <div
                  role="alert"
                  className="rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
                >
                  {submitError}
                </div>
              ) : null}

              {overlappingBlocks.length > 0 ? (
                <div
                  role="alert"
                  className="rounded-2xl border border-amber-400/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
                >
                  <p className="font-medium text-amber-200">
                    Your selected time overlaps with existing venue activity. You can still
                    submit the request.
                  </p>
                  <ul className="mt-3 space-y-2">
                    {overlappingBlocks.map((block, index) => (
                      <li
                        key={`${block.label}-${block.startTime}-${block.endTime}-${index}`}
                        className="rounded-xl border border-amber-300/15 bg-black/10 px-3 py-2"
                      >
                        {block.label}: {formatLocalTime(block.startTime)} to{" "}
                        {formatLocalTime(block.endTime)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <label
                    htmlFor="venue-request-organizerName"
                    className="mb-2 block text-sm font-medium text-slate-200"
                  >
                    Organizer Name
                    {requiredMark}
                  </label>
                  <input
                    id="venue-request-organizerName"
                    name="organizerName"
                    type="text"
                    value={formState.organizerName}
                    onChange={handleChange}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                  />
                  {errors.organizerName ? (
                    <p className="mt-2 text-sm text-rose-300">{errors.organizerName}</p>
                  ) : null}
                </div>

                <div>
                  <label
                    htmlFor="venue-request-orgName"
                    className="mb-2 block text-sm font-medium text-slate-200"
                  >
                    Organization
                  </label>
                  <input
                    id="venue-request-orgName"
                    name="orgName"
                    type="text"
                    value={formState.orgName}
                    onChange={handleChange}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                  />
                  {errors.orgName ? (
                    <p className="mt-2 text-sm text-rose-300">{errors.orgName}</p>
                  ) : null}
                </div>

                <div>
                  <label
                    htmlFor="venue-request-contactEmail"
                    className="mb-2 block text-sm font-medium text-slate-200"
                  >
                    Email
                    {requiredMark}
                  </label>
                  <input
                    id="venue-request-contactEmail"
                    name="contactEmail"
                    type="email"
                    value={formState.contactEmail}
                    onChange={handleChange}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                  />
                  {errors.contactEmail ? (
                    <p className="mt-2 text-sm text-rose-300">{errors.contactEmail}</p>
                  ) : null}
                </div>

                <div>
                  <label
                    htmlFor="venue-request-contactPhone"
                    className="mb-2 block text-sm font-medium text-slate-200"
                  >
                    Phone
                  </label>
                  <input
                    id="venue-request-contactPhone"
                    name="contactPhone"
                    type="tel"
                    value={formState.contactPhone}
                    onChange={handleChange}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                  />
                  {errors.contactPhone ? (
                    <p className="mt-2 text-sm text-rose-300">{errors.contactPhone}</p>
                  ) : null}
                </div>

                <div>
                  <label
                    htmlFor="venue-request-title"
                    className="mb-2 block text-sm font-medium text-slate-200"
                  >
                    Event Title
                    {requiredMark}
                  </label>
                  <input
                    id="venue-request-title"
                    name="title"
                    type="text"
                    value={formState.title}
                    onChange={handleChange}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                  />
                  {errors.title ? (
                    <p className="mt-2 text-sm text-rose-300">{errors.title}</p>
                  ) : null}
                </div>

                <div>
                  <label
                    htmlFor="venue-request-type"
                    className="mb-2 block text-sm font-medium text-slate-200"
                  >
                    Event Type
                    {requiredMark}
                  </label>
                  <select
                    id="venue-request-type"
                    name="type"
                    value={formState.type}
                    onChange={handleChange}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                  >
                    <option value="">Select an event type</option>
                    {EVENT_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {errors.type ? (
                    <p className="mt-2 text-sm text-rose-300">{errors.type}</p>
                  ) : null}
                </div>

                <div>
                  <label
                    htmlFor="venue-request-date"
                    className="mb-2 block text-sm font-medium text-slate-200"
                  >
                    Date
                    {requiredMark}
                  </label>
                  <input
                    id="venue-request-date"
                    name="date"
                    type="date"
                    value={formState.date}
                    onChange={handleChange}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                  />
                  {errors.date ? (
                    <p className="mt-2 text-sm text-rose-300">{errors.date}</p>
                  ) : null}
                </div>

                <div>
                  <label
                    htmlFor="venue-request-expectedAttendees"
                    className="mb-2 block text-sm font-medium text-slate-200"
                  >
                    Expected Attendees
                  </label>
                  <input
                    id="venue-request-expectedAttendees"
                    name="expectedAttendees"
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={formState.expectedAttendees}
                    onChange={handleChange}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                  />
                  {errors.expectedAttendees ? (
                    <p className="mt-2 text-sm text-rose-300">
                      {errors.expectedAttendees}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label
                    htmlFor="venue-request-startTime"
                    className="mb-2 block text-sm font-medium text-slate-200"
                  >
                    Start Time
                    {requiredMark}
                  </label>
                  <input
                    id="venue-request-startTime"
                    name="startTime"
                    type="time"
                    value={formState.startTime}
                    onChange={handleChange}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                  />
                  {errors.startTime ? (
                    <p className="mt-2 text-sm text-rose-300">{errors.startTime}</p>
                  ) : null}
                </div>

                <div>
                  <label
                    htmlFor="venue-request-endTime"
                    className="mb-2 block text-sm font-medium text-slate-200"
                  >
                    End Time
                    {requiredMark}
                  </label>
                  <input
                    id="venue-request-endTime"
                    name="endTime"
                    type="time"
                    value={formState.endTime}
                    onChange={handleChange}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                  />
                  {errors.endTime ? (
                    <p className="mt-2 text-sm text-rose-300">{errors.endTime}</p>
                  ) : null}
                </div>
              </div>

              <div>
                <label
                  htmlFor="venue-request-description"
                  className="mb-2 block text-sm font-medium text-slate-200"
                >
                  Description
                </label>
                <textarea
                  id="venue-request-description"
                  name="description"
                  rows={5}
                  value={formState.description}
                  onChange={handleChange}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                  placeholder="Tell the team about the event, format, and any setup needs."
                />
                {errors.description ? (
                  <p className="mt-2 text-sm text-rose-300">{errors.description}</p>
                ) : null}
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-slate-400">Fields marked with * are required.</p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="rounded-2xl bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-cyan-200"
                  >
                    {isSubmitting ? "Submitting..." : "Submit Request"}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
