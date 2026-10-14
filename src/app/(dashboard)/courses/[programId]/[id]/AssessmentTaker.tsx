"use client";

import { useState } from "react";
import { 
  CheckCircle2, 
  Circle, 
  Square, 
  CheckSquare, 
  Type, 
  Send, 
  Loader2,
  AlertCircle
} from "lucide-react";
import { submitAssessment } from "../../actions";
import { useRouter, useSearchParams } from "next/navigation";

export default function AssessmentTaker({ assessment }: { assessment: any }) {
  const [answers, setAnswers] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const cohortId = searchParams.get("cohortId");

  const handleOptionToggle = (itemId: string, optionId: string, type: string) => {
    setAnswers(prev => {
      const existing = prev.find(a => a.itemId === itemId);
      if (type === "single_choice") {
        if (existing) {
          return prev.map(a => a.itemId === itemId ? { ...a, selectedOptionIds: [optionId] } : a);
        }
        return [...prev, { itemId, selectedOptionIds: [optionId] }];
      } else {
        // multiple_choice
        if (existing) {
          const ids = existing.selectedOptionIds || [];
          const newIds = ids.includes(optionId) ? ids.filter((id: string) => id !== optionId) : [...ids, optionId];
          return prev.map(a => a.itemId === itemId ? { ...a, selectedOptionIds: newIds } : a);
        }
        return [...prev, { itemId, selectedOptionIds: [optionId] }];
      }
    });
  };

  const handleTextChange = (itemId: string, text: string) => {
    setAnswers(prev => {
      const existing = prev.find(a => a.itemId === itemId);
      if (existing) {
        return prev.map(a => a.itemId === itemId ? { ...a, textAnswer: text } : a);
      }
      return [...prev, { itemId, textAnswer: text }];
    });
  };

  const handleSubmit = async () => {
    if (assessment.items.length > answers.length) {
       if (!confirm("You have unanswered questions. Submit anyway?")) return;
    }

    setSubmitting(true);
    try {
      await submitAssessment(assessment.id, cohortId || undefined, answers);
      setCompleted(true);
    } catch (err) {
      console.error(err);
      alert("Failed to submit assessment");
    } finally {
      setSubmitting(false);
    }
  };

  if (completed) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-12 text-center border border-slate-200 dark:border-slate-800 shadow-xl max-w-2xl mx-auto">
        <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="h-10 w-10" />
        </div>
        <h2 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight mb-4">Assessment Submitted!</h2>
        <p className="text-slate-500 dark:text-slate-400 mb-8">Your answers have been saved. If there are free-text questions, your instructor will review them soon. Otherwise, your score is calculated automatically.</p>
        <button 
          onClick={() => router.back()}
          className="px-8 py-3 bg-primary hover:bg-primary-dark text-white rounded-xl font-bold transition-all shadow-lg"
        >
          Back to Course
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-3xl mx-auto pb-24">
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-8 shadow-sm">
         <h2 className="text-sm font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Assessment</h2>
         <h1 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tight leading-none">{assessment.name}</h1>
      </div>

      <div className="space-y-6">
        {assessment.items.map((item: any, idx: number) => {
          const answer = answers.find(a => a.itemId === item.id);
          return (
            <div key={item.id} className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden p-8 space-y-6 animate-fade-in" style={{ animationDelay: `${idx * 0.1}s` }}>
              <div className="flex items-center gap-2">
                 <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded inline-block">Question {idx + 1}</span>
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">{item.questionText}</h3>

              {item.type !== "free_text" && (
                <div className="space-y-3 pt-2">
                  {item.options.map((opt: any) => {
                    const isSelected = answer?.selectedOptionIds?.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        onClick={() => handleOptionToggle(item.id, opt.id, item.type)}
                        className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all text-left ${
                          isSelected 
                            ? "bg-primary/5 border-primary text-primary" 
                            : "bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300"
                        }`}
                      >
                        <div className={`p-1 rounded-md ${isSelected ? 'text-primary' : 'text-slate-300'}`}>
                          {item.type === "single_choice" ? (
                            isSelected ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />
                          ) : (
                            isSelected ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />
                          )}
                        </div>
                        <span className="font-semibold">{opt.text}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {item.type === "free_text" && (
                <div className="pt-2">
                  <textarea
                    value={answer?.textAnswer || ""}
                    onChange={(e) => handleTextChange(item.id, e.target.value)}
                    placeholder="Type your response here..."
                    className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all min-h-[150px]"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-sm px-4">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full flex items-center justify-center gap-3 px-8 py-4 bg-primary hover:bg-primary-dark text-white rounded-2xl font-black uppercase tracking-widest transition-all shadow-xl shadow-primary/40 disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          {submitting ? "Submitting..." : "Finish & Submit"}
        </button>
      </div>

    </div>
  );
}
