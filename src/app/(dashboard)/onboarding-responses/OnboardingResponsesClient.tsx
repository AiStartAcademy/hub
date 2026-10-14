"use client";

import { useState, useTransition } from "react";
import {
  ClipboardList,
  Trash2,
  Loader2,
  ChevronDown,
  Download,
  RefreshCw,
  Settings2,
  CheckCircle2,
  XCircle,
  X,
  User,
  Phone,
  Mail,
  Eye,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import {
  deleteOnboardingResponse,
  updateGhlFieldMapping,
  syncOnboardingToGHL,
  syncOnboardingResponsesToLeads,
} from "../admin/onboarding/actions";
import { useRouter } from "next/navigation";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import {
  parseFieldMapping,
  resolveFieldMapping,
  type OnboardingFieldMapping,
} from "@/lib/onboarding-fields";


interface Option {
  id: string;
  text: string;
  tag: string;
}
interface Element {
  id: string;
  type: string;
  label: string;
  options: Option[];
}
interface Step {
  id: string;
  title: string;
  elements: Element[];
}
interface Form {
  id: string;
  title: string;
  slug: string;
  steps: Step[];
  ghlFieldMapping?: string | null;
}
interface Response {
  id: string;
  formId: string;
  answers: string;
  tagCounts: string;
  cohortId: string | null;
  status?: string;
  aiResult?: string | null;
  attribution?: string | null;
  createdAt: string;
  form: Form;
  cohort: { id: string; title: string } | null;
}

type AiRecommendation = {
  programId?: string;
  programName?: string;
  recommendedProgramName?: string;
  matchPercentage?: number;
  reasoning?: string;
};

function parseAiRecommendations(raw: string | null | undefined): AiRecommendation[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (Array.isArray(parsed.recommendations)) {
      return parsed.recommendations.filter(
        (recommendation): recommendation is AiRecommendation =>
          !!recommendation && typeof recommendation === "object"
      );
    }
    if (typeof parsed.recommendedProgramName === "string") {
      return [parsed as AiRecommendation];
    }
  } catch {
    // Invalid legacy AI results are displayed as empty.
  }
  return [];
}

/** Parse the stored attribution JSON into a flat, display-friendly record. */
function parseAttribution(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}
interface FormSummary {
  id: string;
  title: string;
  slug: string;
  ghlFieldMapping?: string | null;
  steps: {
    id: string;
    title: string;
    elements: { id: string; label: string; type: string }[];
  }[];
  responses: { id: string }[];
}

function resolveDisplayMapping(form: Form): OnboardingFieldMapping {
  const configured = parseFieldMapping(form.ghlFieldMapping);
  const elements = form.steps.flatMap((step) =>
    step.elements.map((element) => ({
      id: element.id,
      label: element.label,
      type: element.type,
    }))
  );
  return resolveFieldMapping(elements, configured);
}

function resolveAnswer(
  el: Element,
  raw: string | string[] | undefined
): string {
  if (raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0))
    return "—";
  if (el.type === "text_single" || el.type === "text_multi" || el.type === "phone") {
    return String(raw);
  }
  if (el.type === "single_choice") {
    const opt = el.options.find((o) => o.id === raw);
    return opt ? opt.text : String(raw);
  }
  if (el.type === "multiple_choice") {
    const ids = Array.isArray(raw) ? raw : [raw];
    return ids.map((id) => el.options.find((o) => o.id === id)?.text ?? id).join(", ");
  }
  return String(raw);
}

/** Flat list of all elements across steps */
function getColumns(form: Form): { stepTitle: string; el: Element }[] {
  return form.steps.flatMap((step) =>
    step.elements.map((el) => ({ stepTitle: step.title, el }))
  );
}

function escapeCSV(value: string): string {
  const safeValue = /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value;
  if (safeValue.includes('"') || safeValue.includes(",") || safeValue.includes("\n")) {
    return `"${safeValue.replace(/"/g, '""')}"`;
  }
  return safeValue;
}

function exportToCSV(form: Form, responses: Response[]) {
  const columns = getColumns(form);
  const headers = [
    "Date",
    "Cohort",
    "Top Tag",
    "AI Status",
    "AI Recommendations",
    "UTM Source",
    "UTM Medium",
    "UTM Campaign",
    "UTM Content",
    "Click ID",
    "Landing Page",
    ...columns.map(({ el }) => el.label),
  ];

  const rows = responses.map((resp) => {
    const rawAnswers: Record<string, string | string[]> = JSON.parse(resp.answers || "{}");
    const tagCounts: Record<string, number> = JSON.parse(resp.tagCounts || "{}");
    const topTag = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])[0];
    
    // Parse AI recommendations for CSV
    let aiRecsString = "";
    const recommendations = parseAiRecommendations(resp.aiResult);
    if (recommendations.length > 0) {
      aiRecsString = recommendations
        .map((recommendation) => {
          const name = recommendation.programName ?? recommendation.recommendedProgramName ?? "Course";
          return recommendation.matchPercentage === undefined
            ? name
            : `${name} (${recommendation.matchPercentage}%)`;
        })
        .join("; ");
    }

    const attr = parseAttribution(resp.attribution);
    const clickId = attr.fbclid || attr.gclid || attr.ttclid || attr.li_fat_id || attr.msclkid || attr.twclid || "";

    return [
      new Date(resp.createdAt).toLocaleString("ru-RU"),
      resp.cohort?.title ?? "",
      topTag ? topTag[0] : "",
      resp.status ?? "",
      aiRecsString,
      attr.utm_source ?? "",
      attr.utm_medium ?? "",
      attr.utm_campaign ?? "",
      attr.utm_content ?? "",
      clickId,
      attr.landing_page ?? "",
      ...columns.map(({ el }) => resolveAnswer(el, rawAnswers[el.id])),
    ];
  });

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => escapeCSV(String(cell === "—" ? "" : cell))).join(","))
    .join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${form.slug}-responses.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Modals ──────────────────────────────────────────────────────────────

function FieldMappingModal({
  formSummary,
  onClose,
  onSaved,
}: {
  formSummary: FormSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = parseFieldMapping(formSummary.ghlFieldMapping);

  const [firstName, setFirstName] = useState(existing.firstName ?? "");
  const [lastName, setLastName] = useState(existing.lastName ?? "");
  const [contactName, setContactName] = useState(existing.contactName ?? "");
  const [phone, setPhone] = useState(existing.phone ?? "");
  const [email, setEmail] = useState(existing.email ?? "");
  const [saving, setSaving] = useState(false);

  const elements = formSummary.steps.flatMap((s) =>
    s.elements.map((el) => ({ ...el, stepTitle: s.title }))
  );
  const textElements = elements.filter(
    (element) => element.type === "text_single" || element.type === "text_multi"
  );
  const phoneElements = elements.filter((element) => element.type === "phone");
  const phoneMappingElements = [...textElements, ...phoneElements];

  const handleSave = async () => {
    setSaving(true);
    try {
      const mapping: OnboardingFieldMapping = {};
      if (firstName) mapping.firstName = firstName;
      if (lastName) mapping.lastName = lastName;
      if (contactName) mapping.contactName = contactName;
      if (phone) mapping.phone = phone;
      if (email) mapping.email = email;
      await updateGhlFieldMapping(formSummary.id, mapping);
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md p-6 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <Settings2 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Lead Field Mapping</h2>
            <p className="text-xs text-slate-500">{formSummary.title} · labels are inferred when left blank</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5">
              <User className="h-3.5 w-3.5" /> First Name
            </label>
            <select value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full px-3 py-2.5 text-sm bg-white dark:bg-slate-800 border rounded-xl">
              <option value="">Auto-detect by label</option>
              {textElements.map((el) => (
                <option key={el.id} value={el.id}>{el.label} ({el.stepTitle})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5">
              <User className="h-3.5 w-3.5" /> Last Name
            </label>
            <select value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full px-3 py-2.5 text-sm bg-white dark:bg-slate-800 border rounded-xl">
              <option value="">Auto-detect by label</option>
              {textElements.map((el) => (
                <option key={el.id} value={el.id}>{el.label} ({el.stepTitle})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5">
              <User className="h-3.5 w-3.5" /> Full Name (optional alternative)
            </label>
            <select value={contactName} onChange={(e) => setContactName(e.target.value)} className="w-full px-3 py-2.5 text-sm bg-white dark:bg-slate-800 border rounded-xl">
              <option value="">Auto-detect by label</option>
              {textElements.map((el) => (
                <option key={el.id} value={el.id}>{el.label} ({el.stepTitle})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5">
              <Phone className="h-3.5 w-3.5" /> Phone
            </label>
            <select value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-3 py-2.5 text-sm bg-white dark:bg-slate-800 border rounded-xl">
              <option value="">Auto-detect by label</option>
              {phoneMappingElements.map((el) => (
                <option key={el.id} value={el.id}>{el.label} ({el.stepTitle})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5">
              <Mail className="h-3.5 w-3.5" /> Email
            </label>
            <select value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2.5 text-sm bg-white dark:bg-slate-800 border rounded-xl">
              <option value="">Auto-detect by label</option>
              {textElements.map((el) => (
                <option key={el.id} value={el.id}>{el.label} ({el.stepTitle})</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 bg-emerald-500 text-white rounded-xl flex items-center justify-center">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResponseViewerModal({
  response,
  form,
  onClose,
}: {
  response: Response;
  form: Form;
  onClose: () => void;
}) {
  const rawAnswers: Record<string, string | string[]> = JSON.parse(response.answers || "{}");
  const aiRecs = parseAiRecommendations(response.aiResult);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl overflow-hidden relative flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center gap-4 p-5 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <div className="p-2.5 bg-primary/10 rounded-xl relative">
            <User className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Response Details</h2>
            <p className="text-sm text-slate-500">
               Submitted on {new Date(response.createdAt).toLocaleString("ru-RU")}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 p-6 space-y-8">
          
          {/* AI Result Section */}
          {aiRecs.length > 0 && (
             <div className="bg-primary/5 border border-primary/20 rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                   <Sparkles className="h-4 w-4 text-primary" />
                   AI Recommendations
                </h3>
                <div className="space-y-4">
                   {aiRecs.map((rec, idx) => (
                      <div key={idx} className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm border border-slate-100 dark:border-slate-700">
                         <div className="flex flex-wrap gap-2 justify-between items-center mb-2">
                           <div className="flex items-center gap-2">
                             <span className="font-bold text-slate-900 dark:text-white text-base">
                               {rec.programName || rec.recommendedProgramName}
                             </span>
                             {rec.programId && (
                               <a 
                                 href={`/courses/${rec.programId}`} 
                                 target="_blank" 
                                 rel="noreferrer"
                                 className="text-slate-400 hover:text-primary transition-colors"
                                 title="Open Course in Admin"
                                 onClick={(e) => e.stopPropagation()}
                               >
                                 <ExternalLink className="h-4 w-4" />
                               </a>
                             )}
                           </div>
                           {rec.matchPercentage && <span className="bg-primary/10 text-primary text-xs px-2 py-1 rounded-md font-bold">{rec.matchPercentage}% Match</span>}
                         </div>
                         <p className="text-sm text-slate-600 dark:text-slate-400">
                            {rec.reasoning}
                         </p>
                      </div>
                   ))}
                </div>
             </div>
          )}

          {response.status === "PROCESSING" && (
             <div className="flex items-center gap-2 text-sm text-slate-500 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
               <Loader2 className="h-4 w-4 animate-spin text-primary" /> AI is currently analyzing this response...
             </div>
          )}

          {/* Form Answers */}
          <div>
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">User Answers</h3>
            <div className="space-y-4">
              {form.steps.map((step) => (
                <div key={step.id}>
                  {step.elements.map((el) => {
                    const answer = resolveAnswer(el, rawAnswers[el.id]);
                    return (
                      <div key={el.id} className="py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
                         <div className="text-sm font-medium text-slate-900 dark:text-gray-300 mb-1">{el.label}</div>
                         <div className="text-slate-600 dark:text-slate-500 text-sm whitespace-pre-wrap">{answer || "—"}</div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}

function SyncResultToast({
  results,
  onClose,
}: {
  results: { responseId: string; ok: boolean; error?: string }[];
  onClose: () => void;
}) {
  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.filter((r) => !r.ok).length;

  return (
    <div className="fixed bottom-6 right-6 z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-5 max-w-sm animate-in slide-in-from-bottom-4">
      <button onClick={onClose} className="absolute top-3 right-3 text-slate-400">
        <X className="h-4 w-4" />
      </button>
      <h3 className="text-base font-bold mb-2">Sync Completed</h3>
      <div className="flex items-center gap-4 text-sm">
        <span className="flex items-center gap-1.5 text-emerald-600"><CheckCircle2 className="h-4 w-4" /> {okCount} success</span>
        {failCount > 0 && <span className="flex items-center gap-1.5 text-rose-500"><XCircle className="h-4 w-4" /> {failCount} failed</span>}
      </div>
    </div>
  );
}

// ─── Form table ──────────────────────────────────────────────────────────────

function FormTable({
  form,
  responses,
}: {
  form: Form;
  responses: Response[];
}) {
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewingResponse, setViewingResponse] = useState<Response | null>(null);
  const router = useRouter();

  const columns = getColumns(form);

  const mappingConfig = resolveDisplayMapping(form);
  const elementById = new Map(columns.map(({ el }) => [el.id, el]));

  const getMappedAnswer = (
    elementId: string | undefined,
    rawAnswers: Record<string, string | string[]>
  ): string => {
    if (!elementId) return "—";
    const element = elementById.get(elementId);
    if (!element) return "—";
    return resolveAnswer(element, rawAnswers[elementId]);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Don't open the modal
    if (!confirm("Delete this response?")) return;
    setDeletingId(id);
    startTransition(async () => {
      try {
        await deleteOnboardingResponse(id);
        router.refresh();
      } catch {
        alert("Failed to delete response");
      } finally {
        setDeletingId(null);
      }
    });
  };

  if (responses.length === 0) {
    return <p className="text-sm text-slate-400 px-1">No responses yet.</p>;
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm custom-scrollbar">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/60">
              <th className="sticky left-0 z-20 bg-slate-50 dark:bg-slate-800/60 px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap border-b border-slate-200 dark:border-slate-700">
                Date
              </th>
              
              {/* Contact Information */}
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide border-b border-slate-200 dark:border-slate-700 whitespace-nowrap">
                Contact Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide border-b border-slate-200 dark:border-slate-700 whitespace-nowrap">
                Phone
              </th>
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide border-b border-slate-200 dark:border-slate-700 whitespace-nowrap min-w-[150px]">
                Email
              </th>

              {/* AI Result */}
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide border-b border-slate-200 dark:border-slate-700 whitespace-nowrap">
                AI Recommendation
              </th>

              {/* Original Dynamic Form Columns */}
              {columns.map(({ stepTitle, el }) => (
                <th
                  key={el.id}
                  className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide border-b border-slate-200 dark:border-slate-700 min-w-[200px]"
                  title={stepTitle}
                >
                  <span className="block max-w-[250px] truncate">{el.label}</span>
                  <span className="block text-[10px] font-normal text-slate-400 normal-case tracking-normal mt-0.5 truncate max-w-[250px]">
                    {stepTitle}
                  </span>
                </th>
              ))}

              {/* Tags & Cohort */}
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide border-b border-slate-200 dark:border-slate-700 whitespace-nowrap">
                Tag / Cohort
              </th>

              {/* Action */}
              <th className="sticky right-0 z-20 bg-slate-50 dark:bg-slate-800/60 px-4 py-3 border-b border-slate-200 dark:border-slate-700" />
            </tr>
          </thead>
          <tbody>
            {responses.map((resp, idx) => {
              const rawAnswers: Record<string, string | string[]> = JSON.parse(resp.answers || "{}");
              const tagCounts: Record<string, number> = JSON.parse(resp.tagCounts || "{}");
              const topTag = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])[0];
              const isDeleting = deletingId === resp.id && isPending;

              // Resolve contact fields based on mapping
              const firstNameAns = getMappedAnswer(mappingConfig.firstName, rawAnswers);
              const lastNameAns = getMappedAnswer(mappingConfig.lastName, rawAnswers);
              const fullNameAns = getMappedAnswer(mappingConfig.contactName, rawAnswers);
              const nameAns = [firstNameAns, lastNameAns]
                .filter((value) => value !== "—")
                .join(" ") || fullNameAns;
                 
              const phoneAns = getMappedAnswer(mappingConfig.phone, rawAnswers);
                 
              const emailAns = getMappedAnswer(mappingConfig.email, rawAnswers);

              // Resolve AI String (Preview)
              let aiPreviewText = "—";
              if (resp.status === "PROCESSING") {
                  aiPreviewText = "Processing...";
              } else if (resp.aiResult) {
                 try {
                   const parsed = JSON.parse(resp.aiResult);
                   if (parsed.recommendations && parsed.recommendations.length > 0) {
                      aiPreviewText = parsed.recommendations[0].programName;
                      if (parsed.recommendations.length > 1) {
                         aiPreviewText += ` (+${parsed.recommendations.length - 1} more)`;
                      }
                   } else if (parsed.recommendedProgramName) {
                      aiPreviewText = parsed.recommendedProgramName;
                   }
                 } catch {
                   aiPreviewText = "Error formatting";
                 }
              }

              const rowClasses = idx % 2 === 0 
                  ? "bg-white dark:bg-slate-900 group-hover:bg-slate-100 dark:group-hover:bg-slate-800" 
                  : "bg-slate-50/50 dark:bg-slate-800/20 group-hover:bg-slate-100 dark:group-hover:bg-slate-800";

              return (
                <tr
                  key={resp.id}
                  onClick={() => setViewingResponse(resp)}
                  className={`group border-b border-slate-100 dark:border-slate-800 last:border-0 cursor-pointer transition-colors ${
                    isDeleting ? "opacity-40 pointer-events-none" : ""
                  }`}
                >
                  {/* Date (Sticky left) */}
                  <td className={`sticky left-0 z-10 px-4 py-3 whitespace-nowrap text-xs text-slate-500 transition-colors ${rowClasses}`}>
                    {new Date(resp.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </td>

                  {/* Contact Info */}
                  <td className={`px-4 py-3 text-sm font-medium text-slate-900 dark:text-white truncate max-w-[150px] transition-colors ${rowClasses}`}>{nameAns}</td>
                  <td className={`px-4 py-3 text-sm text-slate-600 dark:text-slate-400 truncate max-w-[150px] transition-colors ${rowClasses}`}>{phoneAns}</td>
                  <td className={`px-4 py-3 text-sm text-slate-600 dark:text-slate-400 truncate max-w-[200px] transition-colors ${rowClasses}`}>{emailAns}</td>

                  {/* AI Recommendation Preview */}
                  <td className={`px-4 py-3 transition-colors ${rowClasses}`}>
                     {resp.status === "PROCESSING" ? (
                        <span className="flex items-center gap-1.5 text-xs text-amber-500 font-medium">
                           <Loader2 className="h-3 w-3 animate-spin"/> Processing...
                        </span>
                     ) : (
                        <span className="text-sm font-semibold text-primary truncate block max-w-[150px]" title={aiPreviewText}>
                           {aiPreviewText}
                        </span>
                     )}
                  </td>

                  {/* Original Dynamic Form Columns */}
                  {columns.map(({ el }) => {
                    const answer = resolveAnswer(el, rawAnswers[el.id]);
                    return (
                      <td key={el.id} className={`px-4 py-3 text-slate-700 dark:text-slate-300 transition-colors ${rowClasses}`}>
                        <span className="block max-w-[250px] truncate text-sm leading-snug" title={answer}>
                          {answer}
                        </span>
                      </td>
                    );
                  })}

                  {/* Tag / Cohort */}
                  <td className={`px-4 py-3 whitespace-nowrap space-y-1 transition-colors ${rowClasses}`}>
                    {topTag ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                        {topTag[0]}
                      </span>
                    ) : null}
                    <div className="text-xs text-slate-500">{resp.cohort?.title}</div>
                  </td>

                  {/* Actions (Sticky right) */}
                  <td className={`sticky right-0 z-10 px-3 py-3 text-right transition-colors border-l border-slate-100 dark:border-slate-800/50 ${rowClasses}`}>
                    <div className="flex justify-end gap-2 bg-inherit">
                       <button
                         onClick={(e) => { e.stopPropagation(); setViewingResponse(resp) }}
                         className="p-1.5 text-slate-400 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                         title="View Details"
                       >
                         <Eye className="h-4 w-4" />
                       </button>
                       <button
                         disabled={isPending}
                         onClick={(e) => handleDelete(resp.id, e)}
                         className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                         title="Delete"
                       >
                         {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                       </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {viewingResponse && (
         <ResponseViewerModal 
            response={viewingResponse} 
            form={form} 
            onClose={() => setViewingResponse(null)} 
         />
      )}
    </>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function OnboardingResponsesClient({
  responses,
  forms,
}: {
  responses: Response[];
  forms: FormSummary[];
}) {
  const byForm = forms
    .map((f) => ({
      form: responses.find((r) => r.formId === f.id)?.form ?? null,
      formSummary: f,
      responses: responses.filter((r) => r.formId === f.id),
    }))
    .filter((g) => g.responses.length > 0 || g.formSummary);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  const [mappingFormId, setMappingFormId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncResults, setSyncResults] = useState<{ responseId: string; ok: boolean; error?: string }[] | null>(null);

  const router = useRouter();
  const hasAny = responses.length > 0;

  const handleLeadSync = async (formId: string) => {
    if (syncing) return;
    setSyncing(`leads:${formId}`);
    try {
      const results = await syncOnboardingResponsesToLeads(formId);
      setSyncResults(results);
      router.refresh();
    } catch (error) {
      alert("Error: " + (error instanceof Error ? error.message : "Lead sync failed"));
    } finally {
      setSyncing(null);
    }
  };

  const handleGhlSync = async (formId: string) => {
    if (syncing) return;
    setSyncing(`ghl:${formId}`);
    try {
      const results = await syncOnboardingToGHL(formId);
      setSyncResults(results);
    } catch (error) {
      alert("Error: " + (error instanceof Error ? error.message : "GHL sync failed"));
    } finally {
      setSyncing(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700/50 flex items-center px-4 md:px-8 flex-shrink-0 shadow-sm z-10">
        <MobileMenuButton />
        <h1 className="text-lg md:text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2 ml-2 md:ml-0">
          <ClipboardList className="h-5 w-5 md:h-6 md:w-6 text-primary flex-shrink-0" />
          <span className="hidden sm:inline">Onboarding Responses</span>
          <span className="sm:hidden">Responses</span>
        </h1>
        <span className="ml-2 md:ml-3 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-500 flex-shrink-0">
          {responses.length}
        </span>
      </header>

      <div className="flex-1 overflow-auto p-6 md:p-8 bg-slate-50 dark:bg-slate-950">
        {!hasAny ? (
          <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 shadow-sm max-w-lg mx-auto">
            <ClipboardList className="h-12 w-12 mx-auto text-slate-300 mb-3" />
            <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-1">No responses yet</h3>
          </div>
        ) : (
          <div className="space-y-6 max-w-full">
            {byForm.map(({ form, formSummary, responses: formResponses }) => {
              const isCollapsed = collapsed[formSummary.id];
              const displayForm = form
                ? {
                    ...form,
                    ghlFieldMapping:
                      formSummary.ghlFieldMapping ?? form.ghlFieldMapping,
                  }
                : null;
              const isSyncingLeads = syncing === `leads:${formSummary.id}`;
              const isSyncingGhl = syncing === `ghl:${formSummary.id}`;
              const hasMapping = !!formSummary.ghlFieldMapping;

              return (
                <section key={formSummary.id}>
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <button className="flex items-center gap-2 group flex-1 text-left min-w-0" onClick={() => toggle(formSummary.id)}>
                      <h2 className="text-base font-black uppercase tracking-tight text-slate-900 dark:text-white group-hover:text-primary transition-colors truncate">
                        {formSummary.title}
                      </h2>
                      <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-bold">{formResponses.length}</span>
                      <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                    </button>

                    <div className="flex items-center gap-2">
                      <button onClick={() => setMappingFormId(formSummary.id)} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border ${hasMapping ? "text-emerald-600 bg-emerald-50 border-emerald-200" : "text-slate-600 bg-white border-slate-200"}`}>
                        <Settings2 className="h-3.5 w-3.5" /> Fields
                      </button>
                      <button onClick={() => handleLeadSync(formSummary.id)} disabled={!!syncing} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border text-white bg-emerald-500 border-transparent shadow-sm disabled:opacity-50">
                        {isSyncingLeads ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sync Leads
                      </button>
                      <button onClick={() => handleGhlSync(formSummary.id)} disabled={!!syncing || !hasMapping} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border ${hasMapping ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-slate-400 bg-slate-100 border-slate-200"}`}>
                        {isSyncingGhl ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} GHL
                      </button>
                      {displayForm && formResponses.length > 0 && (
                        <button onClick={() => exportToCSV(displayForm, formResponses)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg">
                          <Download className="h-3.5 w-3.5" /> CSV
                        </button>
                      )}
                    </div>
                  </div>

                  {!isCollapsed && displayForm && <FormTable form={displayForm} responses={formResponses} />}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {mappingFormId && <FieldMappingModal formSummary={forms.find((f) => f.id === mappingFormId)!} onClose={() => setMappingFormId(null)} onSaved={() => router.refresh()} />}
      {syncResults && <SyncResultToast results={syncResults} onClose={() => setSyncResults(null)} />}
    </div>
  );
}
