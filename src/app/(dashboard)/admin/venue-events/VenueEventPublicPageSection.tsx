"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import Editor from "@/components/Editor";
import MediaPicker from "@/components/MediaPicker";
import type {
  AgendaItem,
  EventHost,
  FaqEntry,
  GalleryImage,
  PricingTier,
} from "@/lib/venueEventContent";

export interface PublicPageValue {
  subtitle: string;
  description: string;
  cover: string;
  videoUrl: string;
  priceNote: string;
  endDate: string;
  gallery: GalleryImage[];
  agenda: AgendaItem[];
  hosts: EventHost[];
  pricingTiers: PricingTier[];
  faq: FaqEntry[];
}

export const EMPTY_PUBLIC_PAGE_VALUE: PublicPageValue = {
  subtitle: "",
  description: "",
  cover: "",
  videoUrl: "",
  priceNote: "",
  endDate: "",
  gallery: [],
  agenda: [],
  hosts: [],
  pricingTiers: [],
  faq: [],
};

export interface VenueEventPublicPageSectionProps {
  value: PublicPageValue;
  onChange: (next: PublicPageValue) => void;
  disabled: boolean;
}

type MediaPickerState =
  | null
  | { kind: "cover" }
  | { kind: "gallery" }
  | { kind: "host-photo"; index: number };

let rowIdCounter = 0;

function nextRowId(): string {
  rowIdCounter += 1;
  return `venue-event-public-page-row-${rowIdCounter}`;
}

function createRowIds(count: number): string[] {
  return Array.from({ length: count }, () => nextRowId());
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) {
    return items;
  }

  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function useRowIds(length: number): {
  ids: string[];
  onInsert: () => void;
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
} {
  const [ids, setIds] = useState<string[]>(() => createRowIds(length));

  const syncedIds = useMemo(() => {
    if (ids.length === length) {
      return ids;
    }

    if (ids.length < length) {
      return [...ids, ...createRowIds(length - ids.length)];
    }

    return ids.slice(0, length);
  }, [ids, length]);

  useEffect(() => {
    if (syncedIds !== ids) {
      setIds(syncedIds);
    }
  }, [ids, syncedIds]);

  return {
    ids: syncedIds,
    onInsert: () => {
      setIds((current) => [...current, nextRowId()]);
    },
    onRemove: (index: number) => {
      setIds((current) => current.filter((_, currentIndex) => currentIndex !== index));
    },
    onMove: (from: number, to: number) => {
      setIds((current) => moveItem(current, from, to));
    },
  };
}

function getSelectedImageUrl(item: unknown): string | null {
  if (typeof item !== "object" || item === null) {
    return null;
  }

  const candidate = item as { type?: unknown; url?: unknown };
  return candidate.type === "image" && typeof candidate.url === "string" ? candidate.url : null;
}

function RowShell({
  label,
  index,
  count,
  disabled,
  onMoveUp,
  onMoveDown,
  onRemove,
  children,
}: {
  label: string;
  index: number;
  count: number;
  disabled: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onMoveUp}
            disabled={disabled || index === 0}
          >
            Move up
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onMoveDown}
            disabled={disabled || index === count - 1}
          >
            Move down
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onRemove}
            disabled={disabled}
          >
            Remove
          </button>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default function VenueEventPublicPageSection({
  value,
  onChange,
  disabled,
}: VenueEventPublicPageSectionProps): JSX.Element {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [pickerState, setPickerState] = useState<MediaPickerState>(null);
  const galleryRowIds = useRowIds(value.gallery.length);
  const agendaRowIds = useRowIds(value.agenda.length);
  const hostRowIds = useRowIds(value.hosts.length);
  const pricingTierRowIds = useRowIds(value.pricingTiers.length);
  const faqRowIds = useRowIds(value.faq.length);
  const [pricingTierDollarTexts, setPricingTierDollarTexts] = useState<string[]>(() =>
    value.pricingTiers.map((tier) => String(tier.priceCents / 100))
  );

  const patch = (partial: Partial<PublicPageValue>) => {
    onChange({ ...value, ...partial });
  };

  useEffect(() => {
    if (pricingTierDollarTexts.length === value.pricingTiers.length) {
      return;
    }

    setPricingTierDollarTexts((current) =>
      value.pricingTiers.map((tier, index) => current[index] ?? String(tier.priceCents / 100))
    );
  }, [pricingTierDollarTexts.length, value.pricingTiers]);

  const moveGalleryItem = (from: number, to: number) => {
    if (to < 0 || to >= value.gallery.length) {
      return;
    }

    galleryRowIds.onMove(from, to);
    patch({ gallery: moveItem(value.gallery, from, to) });
  };

  const moveAgendaItem = (from: number, to: number) => {
    if (to < 0 || to >= value.agenda.length) {
      return;
    }

    agendaRowIds.onMove(from, to);
    patch({ agenda: moveItem(value.agenda, from, to) });
  };

  const moveHost = (from: number, to: number) => {
    if (to < 0 || to >= value.hosts.length) {
      return;
    }

    hostRowIds.onMove(from, to);
    patch({ hosts: moveItem(value.hosts, from, to) });
  };

  const movePricingTier = (from: number, to: number) => {
    if (to < 0 || to >= value.pricingTiers.length) {
      return;
    }

    pricingTierRowIds.onMove(from, to);
    setPricingTierDollarTexts((current) => moveItem(current, from, to));
    patch({ pricingTiers: moveItem(value.pricingTiers, from, to) });
  };

  const moveFaqEntry = (from: number, to: number) => {
    if (to < 0 || to >= value.faq.length) {
      return;
    }

    faqRowIds.onMove(from, to);
    patch({ faq: moveItem(value.faq, from, to) });
  };

  const handleMediaSelect = (item: unknown) => {
    const imageUrl = getSelectedImageUrl(item);
    if (!imageUrl) {
      return;
    }

    if (pickerState?.kind === "cover") {
      patch({ cover: imageUrl });
      setPickerState(null);
      return;
    }

    if (pickerState?.kind === "gallery") {
      galleryRowIds.onInsert();
      patch({ gallery: [...value.gallery, { url: imageUrl }] });
      setPickerState(null);
      return;
    }

    if (pickerState?.kind === "host-photo") {
      const host = value.hosts[pickerState.index];
      if (!host) {
        setPickerState(null);
        return;
      }

      const next = [...value.hosts];
      next[pickerState.index] = { ...host, photoUrl: imageUrl };
      patch({ hosts: next });
      setPickerState(null);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-950">Public page</h3>
          <p className="mt-1 text-sm text-slate-600">
            These fields drive the public event page visitors see outside the admin.
          </p>
        </div>
        <button
          type="button"
          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => setIsOpen((current) => !current)}
          disabled={disabled}
          aria-expanded={isOpen}
        >
          {isOpen ? (
            <span className="flex items-center gap-1">
              <ChevronDown className="h-4 w-4" />
              Collapse
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <ChevronRight className="h-4 w-4" />
              Expand
            </span>
          )}
        </button>
      </div>

      {isOpen ? (
        <div className="mt-5 space-y-6">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Basics</h4>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-medium text-slate-700">Subtitle</span>
                <input
                  type="text"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                  value={value.subtitle}
                  onChange={(event) => patch({ subtitle: event.target.value })}
                  disabled={disabled}
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-medium text-slate-700">End date</span>
                <input
                  type="date"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                  value={value.endDate}
                  onChange={(event) => patch({ endDate: event.target.value })}
                  disabled={disabled}
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-medium text-slate-700">Video URL</span>
                <input
                  type="text"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                  value={value.videoUrl}
                  onChange={(event) => patch({ videoUrl: event.target.value })}
                  placeholder="https://www.youtube.com/watch?v=..."
                  disabled={disabled}
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-medium text-slate-700">Price note</span>
                <input
                  type="text"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                  value={value.priceNote}
                  onChange={(event) => patch({ priceNote: event.target.value })}
                  placeholder="Free for members"
                  disabled={disabled}
                />
              </label>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-900">Cover</h4>
            <div className="mt-4 space-y-3">
              {value.cover ? (
                <>
                  <p className="break-all font-mono text-xs text-slate-600">{value.cover}</p>
                  <img
                    src={value.cover}
                    alt=""
                    className="h-24 w-auto rounded-md border border-slate-200 object-cover"
                  />
                </>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => setPickerState({ kind: "cover" })}
                  disabled={disabled}
                >
                  Choose image
                </button>
                <button
                  type="button"
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => patch({ cover: "" })}
                  disabled={disabled || !value.cover}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-900">Description</h4>
            <div className="mt-4">
              <div
                className={disabled ? "pointer-events-none opacity-60" : undefined}
                aria-disabled={disabled}
              >
                <Editor
                  content={value.description}
                  onChange={(html) => patch({ description: html })}
                  placeholder="Describe the event for the public page"
                />
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-900">Gallery</h4>
            <div className="mt-4 space-y-4">
              {value.gallery.map((row, index) => (
                <RowShell
                  key={galleryRowIds.ids[index]}
                  label={`Image ${index + 1}`}
                  index={index}
                  count={value.gallery.length}
                  disabled={disabled}
                  onMoveUp={() => moveGalleryItem(index, index - 1)}
                  onMoveDown={() => moveGalleryItem(index, index + 1)}
                  onRemove={() => {
                    galleryRowIds.onRemove(index);
                    patch({
                      gallery: value.gallery.filter((_, currentIndex) => currentIndex !== index),
                    });
                  }}
                >
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <img
                        src={row.url}
                        alt=""
                        className="h-16 w-auto rounded border border-slate-200 object-cover"
                      />
                      <p className="break-all font-mono text-xs text-slate-600">{row.url}</p>
                    </div>
                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      <label className="grid gap-2">
                        <span className="text-sm font-medium text-slate-700">Alt text</span>
                        <input
                          type="text"
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                          value={row.alt ?? ""}
                          onChange={(event) => {
                            const next = [...value.gallery];
                            next[index] = { ...row, alt: event.target.value };
                            patch({ gallery: next });
                          }}
                          disabled={disabled}
                        />
                      </label>
                      <label className="grid gap-2">
                        <span className="text-sm font-medium text-slate-700">Caption</span>
                        <input
                          type="text"
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                          value={row.caption ?? ""}
                          onChange={(event) => {
                            const next = [...value.gallery];
                            next[index] = { ...row, caption: event.target.value };
                            patch({ gallery: next });
                          }}
                          disabled={disabled}
                        />
                      </label>
                    </div>
                  </div>
                </RowShell>
              ))}

              <button
                type="button"
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setPickerState({ kind: "gallery" })}
                disabled={disabled}
              >
                Add image
              </button>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-900">Agenda</h4>
            <div className="mt-4 space-y-4">
              {value.agenda.map((row, index) => (
                <RowShell
                  key={agendaRowIds.ids[index]}
                  label={`Item ${index + 1}`}
                  index={index}
                  count={value.agenda.length}
                  disabled={disabled}
                  onMoveUp={() => moveAgendaItem(index, index - 1)}
                  onMoveDown={() => moveAgendaItem(index, index + 1)}
                  onRemove={() => {
                    agendaRowIds.onRemove(index);
                    patch({
                      agenda: value.agenda.filter((_, currentIndex) => currentIndex !== index),
                    });
                  }}
                >
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">Date</span>
                      <input
                        type="date"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                        value={row.date ?? ""}
                        onChange={(event) => {
                          const next = [...value.agenda];
                          next[index] = { ...row, date: event.target.value };
                          patch({ agenda: next });
                        }}
                        disabled={disabled}
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">Label</span>
                      <input
                        type="text"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                        value={row.label ?? ""}
                        onChange={(event) => {
                          const next = [...value.agenda];
                          next[index] = { ...row, label: event.target.value };
                          patch({ agenda: next });
                        }}
                        disabled={disabled}
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">Start time</span>
                      <input
                        type="text"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                        value={row.startTime ?? ""}
                        onChange={(event) => {
                          const next = [...value.agenda];
                          next[index] = { ...row, startTime: event.target.value };
                          patch({ agenda: next });
                        }}
                        placeholder="6:00 PM"
                        disabled={disabled}
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">End time</span>
                      <input
                        type="text"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                        value={row.endTime ?? ""}
                        onChange={(event) => {
                          const next = [...value.agenda];
                          next[index] = { ...row, endTime: event.target.value };
                          patch({ agenda: next });
                        }}
                        placeholder="9:00 PM"
                        disabled={disabled}
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">Title *</span>
                      <input
                        type="text"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                        value={row.title}
                        onChange={(event) => {
                          const next = [...value.agenda];
                          next[index] = { ...row, title: event.target.value };
                          patch({ agenda: next });
                        }}
                        disabled={disabled}
                      />
                    </label>
                    <label className="grid gap-2 md:col-span-2">
                      <span className="text-sm font-medium text-slate-700">Note</span>
                      <textarea
                        rows={2}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                        value={row.note ?? ""}
                        onChange={(event) => {
                          const next = [...value.agenda];
                          next[index] = { ...row, note: event.target.value };
                          patch({ agenda: next });
                        }}
                        disabled={disabled}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700 md:col-span-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 disabled:cursor-not-allowed"
                        checked={row.isPublic ?? false}
                        onChange={(event) => {
                          const next = [...value.agenda];
                          next[index] = { ...row, isPublic: event.target.checked };
                          patch({ agenda: next });
                        }}
                        disabled={disabled}
                      />
                      Open to the general public
                    </label>
                  </div>
                </RowShell>
              ))}

              <button
                type="button"
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  agendaRowIds.onInsert();
                  patch({ agenda: [...value.agenda, { title: "" }] });
                }}
                disabled={disabled}
              >
                Add agenda item
              </button>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-900">Hosts</h4>
            <div className="mt-4 space-y-4">
              {value.hosts.map((row, index) => (
                <RowShell
                  key={hostRowIds.ids[index]}
                  label={`Host ${index + 1}`}
                  index={index}
                  count={value.hosts.length}
                  disabled={disabled}
                  onMoveUp={() => moveHost(index, index - 1)}
                  onMoveDown={() => moveHost(index, index + 1)}
                  onRemove={() => {
                    hostRowIds.onRemove(index);
                    patch({
                      hosts: value.hosts.filter((_, currentIndex) => currentIndex !== index),
                    });
                  }}
                >
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">Name *</span>
                      <input
                        type="text"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                        value={row.name}
                        onChange={(event) => {
                          const next = [...value.hosts];
                          next[index] = { ...row, name: event.target.value };
                          patch({ hosts: next });
                        }}
                        disabled={disabled}
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">Role</span>
                      <input
                        type="text"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                        value={row.role ?? ""}
                        onChange={(event) => {
                          const next = [...value.hosts];
                          next[index] = { ...row, role: event.target.value };
                          patch({ hosts: next });
                        }}
                        disabled={disabled}
                      />
                    </label>
                    <label className="grid gap-2 md:col-span-2">
                      <span className="text-sm font-medium text-slate-700">Bio</span>
                      <textarea
                        rows={3}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                        value={row.bio ?? ""}
                        onChange={(event) => {
                          const next = [...value.hosts];
                          next[index] = { ...row, bio: event.target.value };
                          patch({ hosts: next });
                        }}
                        disabled={disabled}
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">Profile slug</span>
                      <input
                        type="text"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                        value={row.profileSlug ?? ""}
                        onChange={(event) => {
                          const next = [...value.hosts];
                          next[index] = { ...row, profileSlug: event.target.value };
                          patch({ hosts: next });
                        }}
                        placeholder="hub user slug"
                        disabled={disabled}
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">Photo URL</span>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                          value={row.photoUrl ?? ""}
                          onChange={(event) => {
                            const next = [...value.hosts];
                            next[index] = { ...row, photoUrl: event.target.value };
                            patch({ hosts: next });
                          }}
                          disabled={disabled}
                        />
                        <button
                          type="button"
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => setPickerState({ kind: "host-photo", index })}
                          disabled={disabled}
                        >
                          Choose
                        </button>
                      </div>
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">LinkedIn</span>
                      <input
                        type="text"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                        value={row.links?.linkedin ?? ""}
                        onChange={(event) => {
                          const next = [...value.hosts];
                          next[index] = {
                            ...row,
                            links: {
                              ...(row.links ?? {}),
                              linkedin: event.target.value,
                            },
                          };
                          patch({ hosts: next });
                        }}
                        disabled={disabled}
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">Website</span>
                      <input
                        type="text"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                        value={row.links?.site ?? ""}
                        onChange={(event) => {
                          const next = [...value.hosts];
                          next[index] = {
                            ...row,
                            links: {
                              ...(row.links ?? {}),
                              site: event.target.value,
                            },
                          };
                          patch({ hosts: next });
                        }}
                        disabled={disabled}
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">X</span>
                      <input
                        type="text"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                        value={row.links?.x ?? ""}
                        onChange={(event) => {
                          const next = [...value.hosts];
                          next[index] = {
                            ...row,
                            links: {
                              ...(row.links ?? {}),
                              x: event.target.value,
                            },
                          };
                          patch({ hosts: next });
                        }}
                        disabled={disabled}
                      />
                    </label>
                  </div>
                </RowShell>
              ))}

              <button
                type="button"
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  hostRowIds.onInsert();
                  patch({ hosts: [...value.hosts, { name: "" }] });
                }}
                disabled={disabled}
              >
                Add host
              </button>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-900">Pricing tiers</h4>
            <div className="mt-4 space-y-4">
              {value.pricingTiers.map((row, index) => (
                <RowShell
                  key={pricingTierRowIds.ids[index]}
                  label={`Tier ${index + 1}`}
                  index={index}
                  count={value.pricingTiers.length}
                  disabled={disabled}
                  onMoveUp={() => movePricingTier(index, index - 1)}
                  onMoveDown={() => movePricingTier(index, index + 1)}
                  onRemove={() => {
                    pricingTierRowIds.onRemove(index);
                    setPricingTierDollarTexts((current) =>
                      current.filter((_, currentIndex) => currentIndex !== index)
                    );
                    patch({
                      pricingTiers: value.pricingTiers.filter(
                        (_, currentIndex) => currentIndex !== index
                      ),
                    });
                  }}
                >
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">Label *</span>
                      <input
                        type="text"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                        value={row.label}
                        onChange={(event) => {
                          const next = [...value.pricingTiers];
                          next[index] = { ...row, label: event.target.value };
                          patch({ pricingTiers: next });
                        }}
                        disabled={disabled}
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">Price (dollars)</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                        value={pricingTierDollarTexts[index] ?? ""}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setPricingTierDollarTexts((current) => {
                            const next = [...current];
                            next[index] = nextValue;
                            return next;
                          });

                          const trimmedValue = nextValue.trim();
                          if (!trimmedValue) {
                            return;
                          }

                          const dollars = Number(trimmedValue);
                          if (!Number.isFinite(dollars) || dollars < 0) {
                            return;
                          }

                          const next = [...value.pricingTiers];
                          next[index] = { ...row, priceCents: Math.round(dollars * 100) };
                          patch({ pricingTiers: next });
                        }}
                        disabled={disabled}
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">Note</span>
                      <input
                        type="text"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                        value={row.note ?? ""}
                        onChange={(event) => {
                          const next = [...value.pricingTiers];
                          next[index] = { ...row, note: event.target.value };
                          patch({ pricingTiers: next });
                        }}
                        disabled={disabled}
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">URL</span>
                      <input
                        type="text"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                        value={row.url ?? ""}
                        onChange={(event) => {
                          const next = [...value.pricingTiers];
                          next[index] = { ...row, url: event.target.value };
                          patch({ pricingTiers: next });
                        }}
                        disabled={disabled}
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">
                        Available until
                      </span>
                      <input
                        type="date"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                        value={row.availableUntil ?? ""}
                        onChange={(event) => {
                          const next = [...value.pricingTiers];
                          next[index] = { ...row, availableUntil: event.target.value };
                          patch({ pricingTiers: next });
                        }}
                        disabled={disabled}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 disabled:cursor-not-allowed"
                        checked={row.soldOut ?? false}
                        onChange={(event) => {
                          const next = [...value.pricingTiers];
                          next[index] = { ...row, soldOut: event.target.checked };
                          patch({ pricingTiers: next });
                        }}
                        disabled={disabled}
                      />
                      Sold out
                    </label>
                  </div>
                </RowShell>
              ))}

              <button
                type="button"
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  pricingTierRowIds.onInsert();
                  setPricingTierDollarTexts((current) => [...current, ""]);
                  patch({
                    pricingTiers: [...value.pricingTiers, { label: "", priceCents: 0 }],
                  });
                }}
                disabled={disabled}
              >
                Add pricing tier
              </button>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-900">FAQ</h4>
            <div className="mt-4 space-y-4">
              {value.faq.map((row, index) => (
                <RowShell
                  key={faqRowIds.ids[index]}
                  label={`Question ${index + 1}`}
                  index={index}
                  count={value.faq.length}
                  disabled={disabled}
                  onMoveUp={() => moveFaqEntry(index, index - 1)}
                  onMoveDown={() => moveFaqEntry(index, index + 1)}
                  onRemove={() => {
                    faqRowIds.onRemove(index);
                    patch({
                      faq: value.faq.filter((_, currentIndex) => currentIndex !== index),
                    });
                  }}
                >
                  <div className="mt-5 grid gap-4">
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">Question *</span>
                      <input
                        type="text"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                        value={row.q}
                        onChange={(event) => {
                          const next = [...value.faq];
                          next[index] = { ...row, q: event.target.value };
                          patch({ faq: next });
                        }}
                        disabled={disabled}
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">Answer *</span>
                      <textarea
                        rows={3}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                        value={row.a}
                        onChange={(event) => {
                          const next = [...value.faq];
                          next[index] = { ...row, a: event.target.value };
                          patch({ faq: next });
                        }}
                        disabled={disabled}
                      />
                    </label>
                  </div>
                </RowShell>
              ))}

              <button
                type="button"
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  faqRowIds.onInsert();
                  patch({ faq: [...value.faq, { q: "", a: "" }] });
                }}
                disabled={disabled}
              >
                Add question
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pickerState ? (
        <MediaPicker onSelect={handleMediaSelect} onClose={() => setPickerState(null)} />
      ) : null}
    </section>
  );
}
