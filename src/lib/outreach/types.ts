export type SendOneOffEmailResult =
  | { ok: true; emailEventId: string }
  | { ok: false; error: string };

export type OutreachEmailDraft = {
  subject: string;
  html: string;
};

export type DraftOutreachEmailResult =
  | { ok: true; draft: OutreachEmailDraft }
  | { ok: false; error: string };
