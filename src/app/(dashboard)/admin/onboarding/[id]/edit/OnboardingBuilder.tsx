"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  Trash2,
  GripVertical,
  ChevronDown,
  ChevronUp,
  Loader2,
  Tag,
  Save,
  CheckSquare,
  Phone,
  AlignLeft,
  Type,
  ListChecks,
  ExternalLink,
} from "lucide-react";
import {
  updateOnboardingForm,
  createStep,
  updateStep,
  deleteStep,
  reorderSteps,
  createElement,
  updateElement,
  deleteElement,
  createOption,
  updateOption,
  deleteOption,
  importLegacyTagRoutes,
} from "../../actions";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { deriveStepSlug } from "@/app/onboarding/[slug]/onboardingStepParams";

type Option = { id: string; text: string; tag: string; order: number; nextStepId: string | null; redirectUrl?: string | null };
type Element = { id: string; type: string; label: string; required: boolean; order: number; options: Option[] };
type ElementUpdate = Partial<Pick<Element, "label" | "type" | "required">>;
type OptionUpdate = Partial<Pick<Option, "text" | "tag" | "nextStepId" | "redirectUrl">>;
type Step = { id: string; title: string; slug: string | null; order: number; elements: Element[] };
type Form = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  aiPrompt?: string | null;
  routingElementId?: string | null;
  defaultRedirectUrl?: string | null;
  steps: Step[];
  tagMappings: { id: string }[];
};

const ELEMENT_TYPES = [
  { value: "single_choice", label: "Single Choice", icon: CheckSquare },
  { value: "multiple_choice", label: "Multiple Choice", icon: ListChecks },
  { value: "text_single", label: "Short Text", icon: Type },
  { value: "phone", label: "Phone Number", icon: Phone },
  { value: "text_multi", label: "Long Text", icon: AlignLeft },
];

export default function OnboardingBuilder({
  form: initial,
}: {
  form: Form;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(initial);
  const [saving, setSaving] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<string | null>(form.steps[0]?.id ?? null);
  const manuallyEditedStepSlugs = useRef(
    new Set(
      initial.steps
        .filter((step) => {
          const otherSlugs = initial.steps.flatMap((candidate) =>
            candidate.id !== step.id && candidate.slug ? [candidate.slug] : []
          );
          return step.slug !== deriveStepSlug(step.title, otherSlugs);
        })
        .map((step) => step.id)
    )
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleStepDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = form.steps.findIndex((s) => s.id === active.id);
    const newIndex = form.steps.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(form.steps, oldIndex, newIndex).map((s, i) => ({
      ...s,
      order: i,
    }));

    setForm((f) => ({ ...f, steps: reordered }));

    console.log("[OnboardingBuilder] Saving step order");
    try {
      await reorderSteps(form.id, reordered.map(({ id, order }) => ({ id, order })));
      console.log("[OnboardingBuilder] Step order saved");
    } catch (err) {
      console.error("[OnboardingBuilder] Step reorder error:", err);
    }
  };

  // --- Form meta ---
  const saveFormMeta = async (
    field: "title" | "description" | "slug" | "aiPrompt" | "defaultRedirectUrl",
    value: string
  ) => {
    setSavingField(field);
    setSaveError(null);
    try {
      await updateOnboardingForm(form.id, { [field]: value });
      setForm((f) => ({ ...f, [field]: value }));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save form settings.");
    } finally {
      setSavingField(null);
    }
  };

  // --- Steps ---
  const addStep = async () => {
    setSaving(true);
    try {
      const step = await createStep(form.id, "New Step");
      setForm((f) => ({ ...f, steps: [...f.steps, { ...step, elements: [] }] }));
      setExpandedStep(step.id);
    } finally {
      setSaving(false);
    }
  };

  const removeStep = async (stepId: string) => {
    if (!confirm("Delete this step?")) return;
    await deleteStep(stepId);
    setForm((f) => ({ ...f, steps: f.steps.filter((s) => s.id !== stepId) }));
  };

  const saveStepTitle = async (stepId: string, title: string) => {
    setSaveError(null);
    const otherSlugs = form.steps.flatMap((step) =>
      step.id !== stepId && step.slug ? [step.slug] : []
    );
    const slug = manuallyEditedStepSlugs.current.has(stepId)
      ? undefined
      : deriveStepSlug(title, otherSlugs);

    try {
      const updatedStep = await updateStep(stepId, { title, slug });
      setForm((current) => ({
        ...current,
        steps: current.steps.map((step) =>
          step.id === stepId
            ? { ...step, title: updatedStep.title, slug: updatedStep.slug }
            : step
        ),
      }));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save the step title.");
    }
  };

  const markStepSlugEdited = (stepId: string) => {
    manuallyEditedStepSlugs.current.add(stepId);
  };

  const saveStepSlug = async (stepId: string, slug: string) => {
    setSaveError(null);
    try {
      const updatedStep = await updateStep(stepId, { slug });
      setForm((current) => ({
        ...current,
        steps: current.steps.map((step) =>
          step.id === stepId ? { ...step, slug: updatedStep.slug } : step
        ),
      }));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save the step slug.");
    }
  };

  // --- Elements ---
  const addElement = async (stepId: string, type: string) => {
    const el = await createElement(stepId, { type, label: "New Question" });
    setForm((f) => ({
      ...f,
      steps: f.steps.map((s) =>
        s.id === stepId ? { ...s, elements: [...s.elements, { ...el, options: [] }] } : s
      ),
    }));
  };

  const removeElement = async (stepId: string, elId: string) => {
    if (!confirm("Delete this element?")) return;
    await deleteElement(elId);
    setForm((f) => ({
      ...f,
      steps: f.steps.map((s) => (s.id === stepId ? { ...s, elements: s.elements.filter((e) => e.id !== elId) } : s)),
    }));
  };

  const saveElement = async (elId: string, data: ElementUpdate) => {
    await updateElement(elId, data);
    setForm((f) => ({
      ...f,
      steps: f.steps.map((s) => ({
        ...s,
        elements: s.elements.map((e) => (e.id === elId ? { ...e, ...data } : e)),
      })),
    }));
  };

  // --- Options ---
  const addOption = async (elId: string) => {
    const opt = await createOption(elId, { text: "Option", tag: "" });
    setForm((f) => ({
      ...f,
      steps: f.steps.map((s) => ({
        ...s,
        elements: s.elements.map((e) => (e.id === elId ? { ...e, options: [...e.options, opt] } : e)),
      })),
    }));
  };

  const saveOption = async (elId: string, optId: string, data: OptionUpdate) => {
    setSaveError(null);
    try {
      await updateOption(optId, data);
      setForm((f) => ({
        ...f,
        steps: f.steps.map((s) => ({
          ...s,
          elements: s.elements.map((e) =>
            e.id === elId ? { ...e, options: e.options.map((o) => (o.id === optId ? { ...o, ...data } : o)) } : e
          ),
        })),
      }));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save this answer.");
    }
  };

  const removeOption = async (elId: string, optId: string) => {
    await deleteOption(optId);
    setForm((f) => ({
      ...f,
      steps: f.steps.map((s) => ({
        ...s,
        elements: s.elements.map((e) =>
          e.id === elId ? { ...e, options: e.options.filter((o) => o.id !== optId) } : e
        ),
      })),
    }));
  };

  const routingQuestions = form.steps.flatMap((step) =>
    step.elements
      .filter((element) => element.type === "single_choice")
      .map((element) => ({ ...element, stepTitle: step.title }))
  );

  const saveRoutingQuestion = async (routingElementId: string) => {
    const value = routingElementId || null;
    setSavingField("routingElementId");
    setSaveError(null);
    try {
      await updateOnboardingForm(form.id, { routingElementId: value });
      setForm((current) => ({ ...current, routingElementId: value }));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save redirect routing.");
    } finally {
      setSavingField(null);
    }
  };

  const importLegacyRoutes = async () => {
    if (!confirm("Copy each existing tag destination onto matching answer options? This does not delete the old mappings.")) return;
    setSaving(true);
    setSaveError(null);
    try {
      await importLegacyTagRoutes(form.id);
      window.location.reload();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to import old routes.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700/50 flex items-center gap-2 md:gap-4 px-4 md:px-8 flex-shrink-0">
        <MobileMenuButton />
        <button
          onClick={() => router.push("/admin/onboarding")}
          className="p-2 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Back to Onboarding"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-base md:text-xl font-bold text-slate-900 dark:text-white flex-1 truncate">{form.title}</h1>
        <a
          href={`/onboarding/${form.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors flex-shrink-0 min-h-[44px]"
        >
          <ExternalLink className="h-4 w-4" />
          <span className="hidden sm:inline">Preview</span>
        </a>
      </header>

      <div className="flex-1 overflow-auto p-8 bg-slate-50 dark:bg-slate-950">
        <div className="max-w-3xl mx-auto space-y-6">
          {saveError && (
            <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
              <span>{saveError}</span>
              <button onClick={() => setSaveError(null)} aria-label="Dismiss error" className="font-bold">
                ×
              </button>
            </div>
          )}

          {/* Form Settings */}
          <section className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
            <h2 className="text-sm font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-4">Form Settings</h2>
            <div className="space-y-4">
              <InlineField
                label="Title"
                value={form.title}
                onSave={(v) => saveFormMeta("title", v)}
                saving={savingField === "title"}
              />
              <InlineField
                label="Slug"
                value={form.slug}
                onSave={(v) => saveFormMeta("slug", v)}
                saving={savingField === "slug"}
                prefix="/onboarding/"
                hint="URL-safe, lowercase, hyphens only"
              />
              <InlineField
                label="Description"
                value={form.description ?? ""}
                onSave={(v) => saveFormMeta("description", v)}
                saving={savingField === "description"}
                multiline
              />
              <InlineField
                label="AI System Prompt"
                value={form.aiPrompt ?? ""}
                onSave={(v) => saveFormMeta("aiPrompt", v)}
                saving={savingField === "aiPrompt"}
                multiline
                hint="System Prompt for AI analysis. Leave blank if standard onboarding is used. Context (questions and given answers) will be appended automatically."
              />
              <InlineField
                label="Fallback Redirect URL"
                value={form.defaultRedirectUrl ?? ""}
                onSave={(v) => saveFormMeta("defaultRedirectUrl", v)}
                saving={savingField === "defaultRedirectUrl"}
                hint="Used when the redirect answer has no URL. Use a full https:// link or an internal path such as /cohorts/example."
              />
            </div>
          </section>

          <section className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
            <h2 className="text-sm font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">Redirect Routing</h2>
            <p className="text-xs text-slate-400 mb-4">Choose one single-choice question that decides the redirect. Set a URL directly on each of its answers below; tags are used only for segmentation and CRM.</p>
            <select
              value={form.routingElementId ?? ""}
              onChange={(event) => saveRoutingQuestion(event.target.value)}
              disabled={savingField === "routingElementId"}
              className="w-full max-w-xl px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">No redirect question — use fallback URL only</option>
              {routingQuestions.map((question) => (
                <option key={question.id} value={question.id}>{question.stepTitle}: {question.label || "Untitled question"}</option>
              ))}
            </select>
            {form.tagMappings.length > 0 && (
              <button
                onClick={importLegacyRoutes}
                disabled={saving}
                className="mt-3 text-xs font-medium text-primary hover:underline disabled:opacity-50"
              >
                Import {form.tagMappings.length} legacy tag destination{form.tagMappings.length === 1 ? "" : "s"} into matching answers
              </button>
            )}
          </section>

          {/* Steps */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Steps</h2>
              <button
                onClick={addStep}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add Step
              </button>
            </div>
            
            {form.steps.length === 0 && (
              <div className="text-center py-8 text-slate-400 bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                No steps yet. Add your first step.
              </div>
            )}

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleStepDragEnd}
            >
              <SortableContext
                items={form.steps.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                {(() => {
                  const allSteps = form.steps.map((s) => ({ id: s.id, title: s.title }));
                  return form.steps.map((step, si) => (
                    <StepCard
                      key={step.id}
                      step={step}
                      stepIndex={si}
                      allSteps={allSteps}
                      expanded={expandedStep === step.id}
                      onToggle={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
                      onDeleteStep={() => removeStep(step.id)}
                      onSaveTitle={(t) => saveStepTitle(step.id, t)}
                      onSlugEdited={() => markStepSlugEdited(step.id)}
                      onSaveSlug={(slug) => saveStepSlug(step.id, slug)}
                      formSlug={form.slug}
                      onAddElement={(type) => addElement(step.id, type)}
                      onDeleteElement={(elId) => removeElement(step.id, elId)}
                      onSaveElement={saveElement}
                      onAddOption={addOption}
                      onSaveOption={saveOption}
                      onDeleteOption={removeOption}
                      routingElementId={form.routingElementId ?? null}
                    />
                  ));
                })()}
              </SortableContext>
            </DndContext>
          </section>

        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function InlineField({
  label,
  value,
  onSave,
  saving,
  prefix,
  hint,
  multiline,
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  saving?: boolean;
  prefix?: string;
  hint?: string;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);

  const commit = () => {
    if (val !== value) onSave(val);
    setEditing(false);
  };

  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</label>
      {editing ? (
        <div className="flex items-start gap-2">
          {prefix && <span className="text-sm text-slate-400 mt-2 whitespace-nowrap">{prefix}</span>}
          {multiline ? (
            <textarea
              value={val}
              onChange={(e) => setVal(e.target.value)}
              rows={3}
              autoFocus
              className="flex-1 px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-primary rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
            />
          ) : (
            <input
              type="text"
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commit()}
              autoFocus
              className="flex-1 px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-primary rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          )}
          <button
            onClick={commit}
            disabled={saving}
            className="mt-1 p-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          </button>
        </div>
      ) : (
        <div
          onClick={() => { setVal(value); setEditing(true); }}
          className="flex items-center gap-1 cursor-pointer group"
        >
          {prefix && <span className="text-sm text-slate-400">{prefix}</span>}
          <span className="text-sm text-slate-900 dark:text-white group-hover:text-primary transition-colors">
            {value || <span className="text-slate-400 italic">Click to edit</span>}
          </span>
        </div>
      )}
      {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function StepCard({
  step,
  stepIndex,
  allSteps,
  expanded,
  onToggle,
  onDeleteStep,
  onSaveTitle,
  onSlugEdited,
  onSaveSlug,
  formSlug,
  onAddElement,
  onDeleteElement,
  onSaveElement,
  onAddOption,
  onSaveOption,
  onDeleteOption,
  routingElementId,
}: {
  step: Step;
  stepIndex: number;
  allSteps: { id: string; title: string }[];
  expanded: boolean;
  onToggle: () => void;
  onDeleteStep: () => void;
  onSaveTitle: (t: string) => Promise<void>;
  onSlugEdited: () => void;
  onSaveSlug: (slug: string) => Promise<void>;
  formSlug: string;
  onAddElement: (type: string) => void;
  onDeleteElement: (elId: string) => void;
  onSaveElement: (elId: string, data: ElementUpdate) => void;
  onAddOption: (elId: string) => void;
  onSaveOption: (elId: string, optId: string, data: OptionUpdate) => void;
  onDeleteOption: (elId: string, optId: string) => void;
  routingElementId: string | null;
}) {
  const [editTitle, setEditTitle] = useState(false);
  const [titleVal, setTitleVal] = useState(step.title);
  const [slugVal, setSlugVal] = useState(step.slug ?? "");
  const [showAddElement, setShowAddElement] = useState(false);

  useEffect(() => {
    setSlugVal(step.slug ?? "");
  }, [step.slug]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: step.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden"
    >
      <div className="flex items-center gap-3 px-5 py-3.5 cursor-pointer select-none" onClick={onToggle}>
        <button
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="p-1 text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
          tabIndex={-1}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="text-xs font-bold text-slate-400 uppercase w-14 flex-shrink-0">Step {stepIndex + 1}</span>
        <div className="flex-1 min-w-0 space-y-1.5">
          {editTitle ? (
            <input
              type="text"
              value={titleVal}
              onChange={(e) => setTitleVal(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => { void onSaveTitle(titleVal); setEditTitle(false); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              autoFocus
              className="w-full px-2 py-1 text-sm font-semibold bg-white dark:bg-slate-800 border border-primary rounded-lg focus:outline-none"
            />
          ) : (
            <span
              className="block text-sm font-semibold text-slate-900 dark:text-white hover:text-primary cursor-text"
              onClick={(e) => { e.stopPropagation(); setEditTitle(true); }}
            >
              {step.title}
            </span>
          )}
          <label
            className="flex items-center gap-1 text-[11px] text-slate-400"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="flex-shrink-0">Deep link: /onboarding/{formSlug}?step=</span>
            <input
              type="text"
              value={slugVal}
              maxLength={80}
              placeholder={String(stepIndex + 1)}
              aria-label={`Step ${stepIndex + 1} slug`}
              onChange={(event) => {
                onSlugEdited();
                setSlugVal(event.target.value);
              }}
              onBlur={() => void onSaveSlug(slugVal)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
              className="min-w-0 w-32 border-b border-slate-200 bg-transparent px-1 font-mono text-[11px] text-slate-600 focus:border-primary focus:outline-none dark:border-slate-700 dark:text-slate-300"
            />
          </label>
        </div>
        <span className="text-xs text-slate-400 flex-shrink-0">{step.elements.length} elements</span>
        <button
          onClick={(e) => { e.stopPropagation(); onDeleteStep(); }}
          className="p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </div>

      {expanded && (
        <div className="px-5 pb-5 border-t border-slate-100 dark:border-slate-800 space-y-4 pt-4">
          {step.elements.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-4">No elements yet. Add one below.</p>
          )}

          {step.elements.map((el) => (
            <ElementCard
              key={el.id}
              el={el}
              allSteps={allSteps}
              onDelete={() => onDeleteElement(el.id)}
              onSave={(data) => onSaveElement(el.id, data)}
              onAddOption={() => onAddOption(el.id)}
              onSaveOption={(optId, data) => onSaveOption(el.id, optId, data)}
              onDeleteOption={(optId) => onDeleteOption(el.id, optId)}
              isRoutingElement={el.id === routingElementId}
            />
          ))}

          {/* Add element */}
          {showAddElement ? (
            <div className="grid grid-cols-2 gap-2">
              {ELEMENT_TYPES.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.value}
                    onClick={() => { onAddElement(t.value); setShowAddElement(false); }}
                    className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 hover:bg-primary/5 hover:text-primary border border-slate-200 dark:border-slate-700 rounded-xl transition-colors"
                  >
                    <Icon className="h-4 w-4" />
                    {t.label}
                  </button>
                );
              })}
              <button
                onClick={() => setShowAddElement(false)}
                className="col-span-2 text-xs text-slate-400 hover:text-slate-600 py-1"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAddElement(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-slate-500 hover:text-primary border border-dashed border-slate-300 dark:border-slate-700 hover:border-primary rounded-xl transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add Element
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ElementCard({
  el,
  allSteps,
  onDelete,
  onSave,
  onAddOption,
  onSaveOption,
  onDeleteOption,
  isRoutingElement,
}: {
  el: Element;
  allSteps: { id: string; title: string }[];
  onDelete: () => void;
  onSave: (data: ElementUpdate) => void;
  onAddOption: () => void;
  onSaveOption: (optId: string, data: OptionUpdate) => void;
  onDeleteOption: (optId: string) => void;
  isRoutingElement: boolean;
}) {
  const [label, setLabel] = useState(el.label);
  const [type, setType] = useState(el.type);
  const [required, setRequired] = useState(el.required);
  const isChoice = type === "single_choice" || type === "multiple_choice";

  const typeInfo = ELEMENT_TYPES.find((t) => t.value === type);
  const Icon = typeInfo?.icon ?? Type;

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3 bg-slate-50 dark:bg-slate-800/50">
      <div className="flex items-start gap-3">
        <div className="p-1.5 rounded-lg bg-primary/10 text-primary flex-shrink-0 mt-0.5">
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 space-y-2">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => onSave({ label })}
            onKeyDown={(e) => e.key === "Enter" && onSave({ label })}
            placeholder="Question text"
            className="w-full text-sm font-medium bg-transparent border-b border-slate-200 dark:border-slate-600 focus:outline-none focus:border-primary pb-1 text-slate-900 dark:text-white"
          />
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={type}
              onChange={(e) => { setType(e.target.value); onSave({ type: e.target.value }); }}
              className="text-xs px-2 py-1 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/20"
            >
              {ELEMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => { setRequired(e.target.checked); onSave({ required: e.target.checked }); }}
                className="rounded"
              />
              Required
            </label>
            <button onClick={onDelete} className="ml-auto p-1 rounded text-slate-300 hover:text-rose-500 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {isChoice && (
        <div className="space-y-2 pl-9">
          {el.options.map((opt) => (
            <OptionRow
              key={opt.id}
              opt={opt}
              allSteps={allSteps}
              onSave={(data) => onSaveOption(opt.id, data)}
              onDelete={() => onDeleteOption(opt.id)}
              showRedirectUrl={isRoutingElement}
            />
          ))}
          <button
            onClick={onAddOption}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-primary transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add option
          </button>
        </div>
      )}
    </div>
  );
}

function OptionRow({
  opt,
  allSteps,
  onSave,
  onDelete,
  showRedirectUrl,
}: {
  opt: Option;
  allSteps: { id: string; title: string }[];
  onSave: (data: OptionUpdate) => void;
  onDelete: () => void;
  showRedirectUrl: boolean;
}) {
  const [text, setText] = useState(opt.text);
  const [tag, setTag] = useState(opt.tag);
  const [redirectUrl, setRedirectUrl] = useState(opt.redirectUrl ?? "");

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="w-2 h-2 rounded-full bg-slate-300 flex-shrink-0" />
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onSave({ text })}
        onKeyDown={(e) => e.key === "Enter" && onSave({ text })}
        placeholder="Option text"
        className="flex-1 min-w-[120px] text-sm bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary/20"
      />
      <div className="flex items-center gap-1">
        <Tag className="h-3 w-3 text-slate-400 flex-shrink-0" />
        <input
          type="text"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          onBlur={() => onSave({ tag })}
          onKeyDown={(e) => e.key === "Enter" && onSave({ tag })}
          placeholder="tag"
          className="w-20 text-xs bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary/20 font-mono"
        />
      </div>
      {showRedirectUrl && (
        <input
          type="text"
          inputMode="url"
          value={redirectUrl}
          onChange={(event) => setRedirectUrl(event.target.value)}
          onBlur={() => onSave({ redirectUrl })}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSave({ redirectUrl });
            }
          }}
          placeholder="Redirect URL"
          className="min-w-[180px] flex-1 text-xs bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary/20"
        />
      )}
      {allSteps.length > 1 && (
        <select
          value={opt.nextStepId ?? ""}
          onChange={(e) => onSave({ nextStepId: e.target.value || null })}
          className="text-xs bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary/20 text-slate-500"
          title="Go to step"
        >
          <option value="">→ Next (default)</option>
          {allSteps.map((s) => (
            <option key={s.id} value={s.id}>
              → {s.title}
            </option>
          ))}
        </select>
      )}
      <button onClick={onDelete} className="p-1 rounded text-slate-300 hover:text-rose-500 transition-colors flex-shrink-0">
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
