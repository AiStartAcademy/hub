"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, CheckCircle2, Sparkles, ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  CALL_CONSENT_DISCLOSURE,
  COUNTRY_DIAL_CODES,
  DEFAULT_DIAL_CODE,
  PRIVACY_POLICY_URL,
  SMS_MARKETING_CONSENT_DISCLOSURE,
  SMS_TRANSACTIONAL_CONSENT_DISCLOSURE,
  TERMS_OF_SERVICE_URL,
  dedupeStoredPhoneValue,
  joinStoredPhoneValue,
  splitStoredPhoneValue,
  stripDuplicateDialCode,
} from "@/lib/phone";
import { trackEvent } from "@/lib/analytics";
import type { PhoneConsentChoices } from "@/lib/onboarding-phone-consent";
import { fbqTrack } from "@/lib/metaPixel";
import {
  parse,
  reconcileHistory,
  resolveEntryStep,
  seedHistory,
  serialize,
  stepParamFor,
  submitBlockingStep,
} from "./onboardingStepParams";

type Option = { id: string; text: string; nextStepId: string | null };
type Element = { id: string; type: string; label: string; required: boolean; options: Option[] };
type Step = {
  id: string;
  formId: string;
  slug: string | null;
  order: number;
  title: string;
  elements: Element[];
};
type Form = { id: string; slug: string; title: string; description?: string | null; steps: Step[] };

type InitialNavigation = {
  currentStepId: string;
  stepHistory: string[];
};

type Recommendation = {
  programId: string;
  programName: string;
  matchPercentage: number;
  reasoning: string;
};

type AiResult = {
  recommendations?: Recommendation[];
};

const defaultPhoneCountry =
  COUNTRY_DIAL_CODES.find((entry) => entry.dialCode === DEFAULT_DIAL_CODE) ??
  COUNTRY_DIAL_CODES[0];

export default function OnboardingPlayer({ form }: { form: Form }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const steps = form.steps;
  const urlStepParam = parse(searchParams).step;
  const [initialNavigation] = useState<InitialNavigation>(() => {
    // Deep links land exactly where they point; missing required answers are
    // collected at submit time (see submitBlockingStep in handleSubmit).
    const entryStep = resolveEntryStep(form, urlStepParam);

    return {
      currentStepId: entryStep?.id ?? "",
      stepHistory: entryStep ? seedHistory(form, entryStep) : [],
    };
  });
  const [stepHistory, setStepHistory] = useState<string[]>(initialNavigation.stepHistory);
  const [currentStepId, setCurrentStepId] = useState<string>(initialNavigation.currentStepId);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [phoneConsent, setPhoneConsent] = useState<PhoneConsentChoices>({
    smsMarketing: false,
    smsTransactional: false,
    calls: false,
  });
  const currentStepIdRef = useRef(currentStepId);
  const lastUrlWrittenStep = useRef<string | undefined | null>(null);
  const hasObservedInitialUrl = useRef(false);

  const replaceStepUrl = useCallback(
    (targetStep: Step) => {
      const params = serialize({ step: stepParamFor(form, targetStep) });
      const query = params.toString();
      lastUrlWrittenStep.current = params.get("step") ?? undefined;
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [form, pathname, router]
  );

  useEffect(() => {
    currentStepIdRef.current = currentStepId;
  }, [currentStepId]);

  useEffect(() => {
    if (!hasObservedInitialUrl.current) {
      hasObservedInitialUrl.current = true;
      return;
    }

    if (lastUrlWrittenStep.current !== null && lastUrlWrittenStep.current === urlStepParam) {
      lastUrlWrittenStep.current = null;
      return;
    }
    lastUrlWrittenStep.current = null;

    const incomingStep = resolveEntryStep(form, urlStepParam);
    if (!incomingStep || incomingStep.id === currentStepIdRef.current) return;

    setStepHistory((history) => reconcileHistory(history, incomingStep.id));
    setCurrentStepId(incomingStep.id);
  }, [form, urlStepParam]);

  // States for submission
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [processingAi, setProcessingAi] = useState(false);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [responseId, setResponseId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submissionStarted = useRef(false);

  const currentStep = steps.find((s) => s.id === currentStepId) ?? steps[0];
  const currentStepIndex = steps.findIndex((s) => s.id === currentStepId);
  const progress = steps.length > 0 ? ((stepHistory.length) / steps.length) * 100 : 0;

  // Polling logic for AI results
  useEffect(() => {
    if (!processingAi || !responseId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/onboarding/responses/${responseId}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === "COMPLETED") {
          setProcessingAi(false);
          if (data.aiResult) {
            setAiResult(data.aiResult);
          } else {
             // Fallback when the AI returned no result but the status is COMPLETED
             router.push("/");
          }
          clearInterval(interval);
        } else if (data.status === "ERROR") {
          setProcessingAi(false);
          console.error("AI Analysis failed on the server.");
          clearInterval(interval);
        }
      } catch (error) {
        console.error("Polling error:", error);
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(interval);
  }, [processingAi, responseId, router]);

  const getNextStepId = (): string | null => {
    if (!currentStep) return null;
    for (const el of currentStep.elements) {
      if (el.type === "single_choice") {
        const selectedOptId = answers[el.id] as string | undefined;
        if (selectedOptId) {
          const opt = el.options.find((o) => o.id === selectedOptId);
          if (opt?.nextStepId) return opt.nextStepId;
        }
      }
    }
    if (currentStepIndex >= 0 && currentStepIndex < steps.length - 1) {
      return steps[currentStepIndex + 1].id;
    }
    return null;
  };

  const isLast = getNextStepId() === null;

  // Pending auto-advance timer, so re-clicking a different option resets it.
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); }, []);

  const handleSingle = (elId: string, optId: string) => {
    const nextAnswers = { ...answers, [elId]: optId };
    setAnswers(nextAnswers);

    // Auto-advance only when this single-choice question is the step's sole input.
    const el = currentStep?.elements.find((e) => e.id === elId);
    const stepIsSingleOnly =
      currentStep?.elements.length === 1 && el?.type === "single_choice";
    if (!stepIsSingleOnly || !el) return;

    const opt = el.options.find((o) => o.id === optId);
    const nextId =
      opt?.nextStepId ??
      (currentStepIndex >= 0 && currentStepIndex < steps.length - 1
        ? steps[currentStepIndex + 1].id
        : null);
    const fromStepId = currentStepId;

    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => {
      if (!nextId) {
        handleSubmit(nextAnswers);
        return;
      }

      const nextStep = steps.find((step) => step.id === nextId);
      if (!nextStep) return;

      setStepHistory((history) => [...history, fromStepId]);
      setCurrentStepId(nextStep.id);
      replaceStepUrl(nextStep);
    }, 300);
  };
  const handleMulti = (elId: string, optId: string) => {
    setAnswers((a) => {
      const current = (a[elId] as string[]) || [];
      const next = current.includes(optId) ? current.filter((x) => x !== optId) : [...current, optId];
      return { ...a, [elId]: next };
    });
  };
  const handleText = (elId: string, val: string) => setAnswers((a) => ({ ...a, [elId]: val }));

  const canProceed = () => {
    if (!currentStep) return false;
    return currentStep.elements.every((el) => {
      if (!el.required || el.type === "phone") return true;
      const ans = answers[el.id];
      if (Array.isArray(ans)) return ans.length > 0;
      return !!ans;
    });
  };

  const handleNext = () => {
    const nextId = getNextStepId();
    if (!nextId) return;
    const nextStep = steps.find((step) => step.id === nextId);
    if (!nextStep) return;

    setStepHistory((history) => [...history, currentStepId]);
    setCurrentStepId(nextStep.id);
    replaceStepUrl(nextStep);
  };

  const handleBack = () => {
    if (stepHistory.length === 0) return;
    const previousStepId = stepHistory[stepHistory.length - 1];
    const previousStep = steps.find((step) => step.id === previousStepId);
    if (!previousStep) return;

    setStepHistory((history) => history.slice(0, -1));
    setCurrentStepId(previousStep.id);
    replaceStepUrl(previousStep);
  };

  const handleSubmit = async (finalAnswers: Record<string, string | string[]> = answers) => {
    if (submissionStarted.current) return;
    // Deep-linked visitors may have skipped required questions — walk them
    // back to the first such step instead of posting a thin lead.
    const blockingStep = submitBlockingStep(form, finalAnswers);
    const blockingPlayerStep = blockingStep ? steps.find((step) => step.id === blockingStep.id) : undefined;
    if (blockingPlayerStep && blockingPlayerStep.id !== currentStepId) {
      setStepHistory((history) => [...history, currentStepId]);
      setCurrentStepId(blockingPlayerStep.id);
      replaceStepUrl(blockingPlayerStep);
      setSubmitError("A couple of quick questions first — then we'll wrap up.");
      return;
    }
    submissionStarted.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const submittedAnswers = { ...finalAnswers };
      for (const step of form.steps) {
        for (const element of step.elements) {
          const answer = submittedAnswers[element.id];
          if (element.type === "phone" && typeof answer === "string") {
            submittedAnswers[element.id] = dedupeStoredPhoneValue(answer);
          }
        }
      }
      const res = await fetch(`/api/onboarding/${form.slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: submittedAnswers, phoneConsent }),
      });
      const data = (await res.json()) as {
        error?: string;
        responseId?: string;
        status?: string;
        redirectUrl?: string | null;
        cohortId?: string | null;
      };

      if (!res.ok) {
        throw new Error(data.error || "Unable to submit onboarding response");
      }
      if (!data.responseId) throw new Error("The server returned an invalid response.");

      setDone(true);
      setResponseId(data.responseId);

      // Funnel money-moment: the quiz is the hub's primary lead capture, so the
      // "All done!" screen is the conversion. `submissionStarted` guards against
      // a double push. GA4 standard name so it can be a Key event; GTM forwards
      // it to Meta as `Lead`. No PII in the payload — `response_id` only, which
      // also lets GA4/Meta dedupe if the tag ever re-fires.
      trackEvent("generate_lead", {
        conversion_kind: "onboarding_quiz",
        transaction_id: data.responseId,
        form_slug: form.slug,
        form_name: form.title,
        steps_completed: stepHistory.length + 1,
      });
      // Browser twin of the server's CAPI Lead (same response id as eventID →
      // Meta dedupes). This is the event ad campaigns optimize on.
      fbqTrack("Lead", { content_name: form.slug }, data.responseId);

      if (data.status === "PROCESSING") {
        setProcessingAi(true);
      } else if (data.redirectUrl) {
        // Custom link — may be external, so use a full navigation.
        const redirectUrl = data.redirectUrl;
        setTimeout(() => {
          if (/^https?:\/\//i.test(redirectUrl)) {
            window.location.href = redirectUrl;
          } else {
            router.push(redirectUrl);
          }
        }, 1500);
      } else if (data.cohortId) {
        const cohortId = data.cohortId;
        setTimeout(() => router.push(`/cohorts/${cohortId}`), 1500);
      }
    } catch (error) {
      submissionStarted.current = false;
      setSubmitError(
        error instanceof Error ? error.message : "Unable to submit onboarding response"
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Render processing state or AI result
  if (done) {
    if (processingAi) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center p-4">
          <div className="text-center space-y-6 max-w-sm">
            <div className="relative w-20 h-20 mx-auto">
              <div className="absolute inset-0 rounded-full border-4 border-primary/20 animate-ping"></div>
              <div className="absolute inset-0 rounded-full border-4 border-t-primary animate-spin"></div>
              <Sparkles className="absolute inset-0 m-auto h-8 w-8 text-primary animate-pulse" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Analyzing your answers...</h2>
              <p className="text-slate-500 mt-2">AI is exploring courses to find the perfect match for you.</p>
            </div>
          </div>
        </div>
      );
    }

    if (aiResult) {
      const recs = aiResult.recommendations || [];
      const hasRecs = recs.length > 0;

      if (!hasRecs) {
        return (
          <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center p-6">
             <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl shadow-xl overflow-hidden border border-slate-200 dark:border-slate-800 p-8 text-center space-y-4">
                <p className="text-slate-600 dark:text-slate-400">
                  We gathered your answers, but couldn&apos;t find an exact matching course right now based on our AI analysis.
                </p>
                <Link href={`/courses`} className="inline-block mt-4 text-primary font-medium hover:underline">
                  Explore all courses directly
                </Link>
              </div>
          </div>
        );
      }

      // Layout 1: a single recommended course
      if (recs.length === 1) {
        const singleRec = recs[0];
        return (
          <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center p-6">
            <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl shadow-xl overflow-hidden border border-slate-200 dark:border-slate-800">
              <div className="bg-primary/10 p-6 flex items-center gap-4 relative">
                <div className="absolute top-4 right-4 text-xs font-bold bg-primary text-white px-2 py-0.5 rounded-full shadow-sm">
                  {singleRec.matchPercentage}% MATCH
                </div>
                <div className="p-3 bg-white dark:bg-slate-800 rounded-full shadow-sm">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">Your Perfect Match</h2>
                  <p className="text-sm text-slate-500">Based on your responses</p>
                </div>
              </div>
              
              <div className="p-6 space-y-6">
                <div className="space-y-4">
                   <h3 className="text-xl font-extrabold text-slate-900 dark:text-white">
                     {singleRec.programName}
                   </h3>
                   {singleRec.reasoning && (
                     <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl">
                       {singleRec.reasoning}
                     </p>
                   )}
                </div>
                <Link 
                  href={`/courses/${singleRec.programId}`}
                  className="flex items-center justify-center w-full gap-2 px-6 py-3.5 bg-primary hover:bg-primary/90 text-white font-semibold rounded-xl shadow-lg shadow-primary/25 transition-all"
                >
                  View Course Content
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        );
      }

      // Layout 2: several recommended courses
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-start justify-center p-6 py-12 overflow-y-auto">
          <div className="max-w-2xl w-full">
            <div className="text-center mb-10">
              <div className="inline-flex items-center justify-center p-4 bg-primary/10 rounded-full mb-4">
                <Sparkles className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white">Your Best Matches</h2>
              <p className="text-slate-500 mt-2">We found multiple highly relevant courses for you.</p>
            </div>

            <div className="space-y-6">
              {recs.map((rec, idx) => (
                <div 
                  key={rec.programId} 
                  className={`bg-white dark:bg-slate-900 rounded-2xl shadow-sm border ${idx === 0 ? 'border-primary shadow-primary/10' : 'border-slate-200 dark:border-slate-800'} overflow-hidden relative`}
                >
                  {idx === 0 && (
                    <div className="absolute top-0 right-0 bg-primary text-white text-xs font-bold px-3 py-1 rounded-bl-lg">
                      TOP MATCH • {rec.matchPercentage}%
                    </div>
                  )}
                  {idx !== 0 && (
                     <div className="absolute top-0 right-0 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold px-3 py-1 rounded-bl-lg">
                       {rec.matchPercentage}% MATCH
                     </div>
                  )}
                  <div className="p-6 md:p-8">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                      <div className="flex-1 space-y-3">
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white pr-16 md:pr-0">
                          {rec.programName}
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">
                          {rec.reasoning}
                        </p>
                      </div>
                      <div className="md:w-auto w-full flex-shrink-0 pt-2 md:pt-0">
                        <Link 
                          href={`/courses/${rec.programId}`}
                          className={`flex items-center justify-center gap-2 px-6 py-3 font-semibold rounded-xl transition-all w-full md:w-auto ${
                            idx === 0 
                              ? "bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/25" 
                              : "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white hover:bg-slate-200 dark:hover:bg-slate-700"
                          }`}
                        >
                          View Course <ArrowRight className="h-4 w-4" />
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-sm">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">All done!</h2>
          <p className="text-slate-500">Your response has been saved successfully.</p>
        </div>
      </div>
    );
  }

  if (!currentStep) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        This form has no steps yet.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/70 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Logo" width={28} height={28} className="rounded-lg" />
          <span className="font-bold text-slate-900 dark:text-white text-sm">{form.title}</span>
        </div>
        <span className="text-xs font-medium text-slate-400">
          Step {stepHistory.length + 1}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-slate-200 dark:bg-slate-800">
        <div
          className="h-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Content */}
      <div className="flex-1 flex items-start justify-center py-16 px-4">
        <div className="w-full max-w-xl">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-8">{currentStep.title}</h2>

          <div className="space-y-8">
            {currentStep.elements.map((el) => (
              <ElementInput
                key={el.id}
                el={el}
                value={answers[el.id]}
                onSingle={(optId) => handleSingle(el.id, optId)}
                onMulti={(optId) => handleMulti(el.id, optId)}
                onText={(val) => handleText(el.id, val)}
                phoneConsent={phoneConsent}
                onPhoneConsentChange={setPhoneConsent}
              />
            ))}
          </div>

          <div className="mt-10 flex items-center justify-between">
            {stepHistory.length > 0 ? (
              <button
                onClick={handleBack}
                className="flex items-center gap-1.5 px-5 py-3 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-semibold rounded-xl border-2 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 transition-all"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
            ) : (
              <div />
            )}

            {isLast ? (
              <button
                onClick={() => handleSubmit()}
                disabled={!canProceed() || submitting}
                className="flex items-center gap-2 px-8 py-3 bg-primary hover:bg-primary/90 text-white font-semibold rounded-xl shadow-lg shadow-primary/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Submit
              </button>
            ) : (
              <button
                onClick={handleNext}
                disabled={!canProceed()}
                className="flex items-center gap-2 px-8 py-3 bg-primary hover:bg-primary/90 text-white font-semibold rounded-xl shadow-lg shadow-primary/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
          {submitError && (
            <p role="alert" className="mt-4 text-sm text-rose-600 dark:text-rose-400">
              {submitError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ElementInput({
  el,
  value,
  onSingle,
  onMulti,
  onText,
  phoneConsent,
  onPhoneConsentChange,
}: {
  el: Element;
  value: string | string[] | undefined;
  onSingle: (optId: string) => void;
  onMulti: (optId: string) => void;
  onText: (val: string) => void;
  phoneConsent: PhoneConsentChoices;
  onPhoneConsentChange: (value: PhoneConsentChoices) => void;
}) {
  const selected = value ?? (el.type === "multiple_choice" ? [] : "");

  return (
    <div className="space-y-3">
      <label className="block text-base font-semibold text-slate-900 dark:text-white">
        {el.label}
        {el.required && el.type !== "phone" && <span className="text-rose-500 ml-1">*</span>}
      </label>

      {el.type === "single_choice" && (
        <div className="space-y-2">
          {el.options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => onSingle(opt.id)}
              className={`w-full text-left px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all ${
                selected === opt.id
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-primary/40 hover:bg-primary/5"
              }`}
            >
              {opt.text}
            </button>
          ))}
        </div>
      )}

      {el.type === "multiple_choice" && (
        <div className="space-y-2">
          {el.options.map((opt) => {
            const checked = (selected as string[]).includes(opt.id);
            return (
              <button
                key={opt.id}
                onClick={() => onMulti(opt.id)}
                className={`w-full text-left px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all flex items-center gap-3 ${
                  checked
                    ? "border-primary bg-primary/10 text-primary border-primary"
                    : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-primary/40 hover:bg-primary/5"
                }`}
              >
                <div className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${checked ? "border-primary bg-primary" : "border-slate-300"}`}>
                  {checked && <div className="w-2 h-2 rounded-sm bg-white" />}
                </div>
                {opt.text}
              </button>
            );
          })}
        </div>
      )}

      {el.type === "text_single" && (
        <input
          type="text"
          value={selected as string}
          onChange={(e) => onText(e.target.value)}
          maxLength={500}
          placeholder="Your answer…"
          className="w-full px-4 py-3 text-sm bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-primary transition-colors"
        />
      )}

      {el.type === "phone" && (
        <PhoneField
          key={el.id}
          selected={typeof selected === "string" ? selected : ""}
          onText={onText}
          consent={phoneConsent}
          onConsentChange={onPhoneConsentChange}
        />
      )}

      {el.type === "text_multi" && (
        <textarea
          value={selected as string}
          onChange={(e) => onText(e.target.value)}
          maxLength={5000}
          rows={4}
          placeholder="Your answer…"
          className="w-full px-4 py-3 text-sm bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-primary transition-colors resize-none"
        />
      )}
    </div>
  );
}

function getDialCodeForIsoCode(isoCode: string): string {
  return (
    COUNTRY_DIAL_CODES.find((entry) => entry.isoCode === isoCode)?.dialCode ??
    defaultPhoneCountry.dialCode
  );
}

function getIsoCodeForDialCode(dialCode: string): string {
  return (
    COUNTRY_DIAL_CODES.find((entry) => entry.dialCode === dialCode)?.isoCode ??
    defaultPhoneCountry.isoCode
  );
}

function PhoneField({
  selected,
  onText,
  consent,
  onConsentChange,
}: {
  selected: string;
  onText: (value: string) => void;
  consent: PhoneConsentChoices;
  onConsentChange: (value: PhoneConsentChoices) => void;
}) {
  const initialValue = splitStoredPhoneValue(selected);
  const [isoCode, setIsoCode] = useState<string>(getIsoCodeForDialCode(initialValue.dialCode));
  const [nationalNumber, setNationalNumber] = useState<string>(initialValue.nationalNumber);

  const hasAnyConsent = (value: PhoneConsentChoices) =>
    value.smsMarketing || value.smsTransactional || value.calls;

  const emitValue = (
    nextIsoCode: string,
    nextNationalNumber: string,
    nextConsent: PhoneConsentChoices
  ) => {
    onText(
      hasAnyConsent(nextConsent)
        ? joinStoredPhoneValue(getDialCodeForIsoCode(nextIsoCode), nextNationalNumber)
        : ""
    );
  };

  const handleIsoCodeChange = (nextIsoCode: string) => {
    setIsoCode(nextIsoCode);
    emitValue(nextIsoCode, nationalNumber, consent);
  };

  const handleNationalNumberChange = (nextNationalNumber: string) => {
    setNationalNumber(nextNationalNumber);
    emitValue(isoCode, nextNationalNumber, consent);
  };

  const handleNationalNumberBlur = () => {
    const deduplicated = stripDuplicateDialCode(
      getDialCodeForIsoCode(isoCode),
      nationalNumber
    );
    setNationalNumber(deduplicated);
    emitValue(isoCode, deduplicated, consent);
  };

  const handleConsentChange = (
    kind: keyof PhoneConsentChoices,
    checked: boolean
  ) => {
    const nextConsent = { ...consent, [kind]: checked };
    onConsentChange(nextConsent);
    emitValue(isoCode, nationalNumber, nextConsent);
  };

  return (
    <div>
    <div className="flex flex-wrap gap-3">
      <select
        value={isoCode}
        onChange={(event) => handleIsoCodeChange(event.target.value)}
        autoComplete="tel-country-code"
        className="w-full sm:w-auto sm:max-w-[240px] px-4 py-3 text-sm bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-primary transition-colors"
      >
        {COUNTRY_DIAL_CODES.map((entry) => (
          <option key={entry.isoCode} value={entry.isoCode}>
            {entry.countryName} ({entry.dialCode})
          </option>
        ))}
      </select>
      <input
        type="tel"
        value={nationalNumber}
        onChange={(event) => handleNationalNumberChange(event.target.value)}
        onBlur={handleNationalNumberBlur}
        inputMode="tel"
        autoComplete="tel-national"
        maxLength={20}
        placeholder="(415) 555-0123"
        className="w-full min-w-[220px] flex-1 px-4 py-3 text-sm bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-primary transition-colors"
      />
    </div>
    <div className="mt-3 space-y-3">
      {([
        ["smsMarketing", SMS_MARKETING_CONSENT_DISCLOSURE],
        ["smsTransactional", SMS_TRANSACTIONAL_CONSENT_DISCLOSURE],
        ["calls", CALL_CONSENT_DISCLOSURE],
      ] as const).map(([kind, disclosure]) => (
        <label key={kind} className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={consent[kind]}
            onChange={(event) => handleConsentChange(kind, event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-2 border-slate-300 dark:border-slate-600 accent-primary"
          />
          <span className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {disclosure}
          </span>
        </label>
      ))}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        <a href={TERMS_OF_SERVICE_URL} target="_blank" rel="noopener noreferrer" className="underline">
          Terms of Service
        </a>{" "}
        and{" "}
        <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" className="underline">
          Privacy Policy
        </a>
      </p>
    </div>
    </div>
  );
}
