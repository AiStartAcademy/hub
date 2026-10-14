export interface OnboardingStepParamElement {
  id: string;
  required: boolean;
  type?: string;
}

export interface OnboardingStepParamStep {
  id: string;
  formId: string;
  slug: string | null;
  order: number;
  elements: readonly OnboardingStepParamElement[];
}

export interface OnboardingStepParamForm {
  id: string;
  steps: readonly OnboardingStepParamStep[];
}

export type OnboardingAnswers = Readonly<Record<string, unknown>>;

export interface OnboardingStepUrlState {
  step?: string;
}

type SearchParamsReader = Pick<URLSearchParams, "get" | "getAll">;

const MAX_STEP_PARAM_LENGTH = 100;
const MAX_DERIVED_SLUG_LENGTH = 80;
const SAFE_STEP_PARAM = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*|[1-9]\d*)$/;

function validatedStepParam(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_STEP_PARAM_LENGTH) {
    return undefined;
  }
  return SAFE_STEP_PARAM.test(value) ? value : undefined;
}

function formOwnedSteps(form: OnboardingStepParamForm): OnboardingStepParamStep[] {
  return form.steps
    .filter((step) => step.formId === form.id)
    .slice()
    .sort((left, right) => left.order - right.order);
}

export function parse(searchParams: SearchParamsReader): OnboardingStepUrlState {
  const values = searchParams.getAll("step");
  if (values.length !== 1) return {};
  const step = validatedStepParam(searchParams.get("step"));
  return step ? { step } : {};
}

export function serialize(state: OnboardingStepUrlState): URLSearchParams {
  const params = new URLSearchParams();
  const step = validatedStepParam(state.step);
  if (step) params.set("step", step);
  return params;
}

export function resolveEntryStep(
  form: OnboardingStepParamForm,
  param: unknown
): OnboardingStepParamStep | null {
  const steps = formOwnedSteps(form);
  const firstStep = steps[0] ?? null;
  const value = validatedStepParam(param);
  if (!value) return firstStep;

  const slugMatch = steps.find((step) => step.slug === value);
  if (slugMatch) return slugMatch;

  if (!/^\d+$/.test(value)) return firstStep;
  const position = Number(value);
  if (!Number.isSafeInteger(position) || position < 1) return firstStep;
  return steps[position - 1] ?? firstStep;
}

/**
 * The URL param that addresses `step`: its slug when it has one, otherwise its
 * 1-based position among the form's steps.
 *
 * Position, never `step.order`: order values are 0-based and go non-contiguous
 * after builder edits, while `resolveEntryStep` reads a numeric param as a
 * 1-based position. Writing the raw order desynced the URL from the visible
 * step (a copied link landed one step early).
 */
export function stepParamFor(
  form: OnboardingStepParamForm,
  step: OnboardingStepParamStep
): string {
  if (step.slug) return step.slug;
  const position = formOwnedSteps(form).findIndex((candidate) => candidate.id === step.id);
  // A step outside this form has no addressable position; the first step is the
  // only safe target, and "1" resolves there.
  return String(position < 0 ? 1 : position + 1);
}

/** Returns form-owned step ids before `targetStep`; the target itself is excluded. */
export function seedHistory(
  form: OnboardingStepParamForm,
  targetStep: OnboardingStepParamStep
): string[] {
  const steps = formOwnedSteps(form);
  const targetIndex = steps.findIndex((step) => step.id === targetStep.id);
  if (targetIndex < 0 || targetStep.formId !== form.id) return [];
  return steps.slice(0, targetIndex).map((step) => step.id);
}

function hasAnswer(answer: unknown): boolean {
  if (Array.isArray(answer)) return answer.length > 0;
  if (typeof answer === "string") return answer.trim().length > 0;
  return answer !== undefined && answer !== null && answer !== false;
}

export function firstBlockingStep(
  form: OnboardingStepParamForm,
  targetStep: OnboardingStepParamStep,
  answers: OnboardingAnswers
): OnboardingStepParamStep | null {
  const steps = formOwnedSteps(form);
  const targetIndex = steps.findIndex((step) => step.id === targetStep.id);
  if (targetIndex < 0 || targetStep.formId !== form.id) return null;

  return (
    steps
      .slice(0, targetIndex)
      .find((step) =>
        step.elements.some(
          (element) =>
            element.required && element.type !== "phone" && !hasAnswer(answers[element.id])
        )
      ) ?? null
  );
}

/**
 * Submit-time guard: the first step (in linear order) that still has an
 * unanswered required element, or null when the answers are complete. A
 * deep-linked visitor lands where the link pointed and is walked back here
 * only when they try to submit.
 */
export function submitBlockingStep(
  form: OnboardingStepParamForm,
  answers: OnboardingAnswers
): OnboardingStepParamStep | null {
  return (
    formOwnedSteps(form).find((step) =>
      step.elements.some(
        (element) =>
          element.required && element.type !== "phone" && !hasAnswer(answers[element.id])
      )
    ) ?? null
  );
}

export function reconcileHistory(history: readonly string[], incomingStep: string): string[] {
  if (history[history.length - 1] === incomingStep) return history.slice(0, -1);
  return [...history, incomingStep];
}

export function normalizeStepSlug(value: string): string | null {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_DERIVED_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return normalized || null;
}

export function deriveStepSlug(title: string, existingSlugs: readonly string[]): string {
  const base = normalizeStepSlug(title) ?? "step";
  const occupied = new Set(existingSlugs.map((slug) => slug.toLowerCase()));
  if (!occupied.has(base)) return base;

  for (let suffix = 2; suffix <= existingSlugs.length + 2; suffix += 1) {
    const suffixText = `-${suffix}`;
    const candidate = `${base.slice(0, MAX_DERIVED_SLUG_LENGTH - suffixText.length)}${suffixText}`;
    if (!occupied.has(candidate)) return candidate;
  }

  throw new Error(`Unable to derive a unique onboarding step slug for "${title}".`);
}
