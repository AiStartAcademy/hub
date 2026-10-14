"use client";

import { useState, useEffect, useRef } from "react";
import { 
  ArrowLeft, 
  Plus, 
  Trash2, 
  GripVertical, 
  CheckCircle2, 
  Circle, 
  Square, 
  CheckSquare, 
  Type, 
  Save, 
  Loader2,
  ChevronDown,
  ChevronUp,
  X
} from "lucide-react";
import Link from "next/link";
import { 
  getAssessment, 
  createAssessmentItem, 
  updateAssessmentItem, 
  deleteAssessmentItem,
  createAssessmentOption,
  updateAssessmentOption,
  deleteAssessmentOption,
  updateAssessmentItemsOrder
} from "../../../actions";
import { useRouter } from "next/navigation";
import { MobileMenuButton } from '@/components/MobileMenuButton';

export default function AssessmentEditorPage({ 
  params 
}: { 
  params: Promise<{ programId: string; id: string }> 
}) {
  const [resolvedParams, setResolvedParams] = useState<{ programId: string; id: string } | null>(null);
  const [assessment, setAssessment] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});
  const router = useRouter();

  useEffect(() => {
    params.then(setResolvedParams);
  }, [params]);

  const loadAssessment = async () => {
    if (!resolvedParams) return;
    try {
      const data = await getAssessment(resolvedParams.id);
      setAssessment(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (resolvedParams) loadAssessment();
  }, [resolvedParams]);

  const addItem = async (type: string) => {
    if (!resolvedParams) return;
    try {
      await createAssessmentItem(resolvedParams.id, { 
        questionText: "New Question", 
        type 
      });
      loadAssessment();
    } catch (err) {
      console.error(err);
      alert("Failed to add item");
    }
  };

  const deleteItem = async (itemId: string) => {
    if (!confirm("Remove this question?")) return;
    try {
      await deleteAssessmentItem(itemId);
      loadAssessment();
    } catch (err) {
      console.error(err);
      alert("Failed to delete item");
    }
  };

  const updateItemText = (itemId: string, text: string) => {
    // Update local state immediately
    setAssessment((prev: any) => ({
      ...prev,
      items: prev.items.map((item: any) => 
        item.id === itemId ? { ...item, questionText: text } : item
      )
    }));

    // Debounce server update
    if (saveTimeoutRef.current[itemId]) clearTimeout(saveTimeoutRef.current[itemId]);
    
    saveTimeoutRef.current[itemId] = setTimeout(async () => {
      setSaving(true);
      try {
        await updateAssessmentItem(itemId, { questionText: text });
      } catch (err) {
        console.error(err);
      } finally {
        setSaving(false);
        delete saveTimeoutRef.current[itemId];
      }
    }, 1000);
  };

  const addOption = async (itemId: string) => {
    try {
      await createAssessmentOption(itemId, { text: "New Option", isCorrect: false });
      loadAssessment();
    } catch (err) {
      console.error(err);
    }
  };

  const deleteOption = async (optionId: string) => {
    try {
      await deleteAssessmentOption(optionId);
      loadAssessment();
    } catch (err) {
      console.error(err);
    }
  };

  const toggleCorrect = async (option: any, itemType: string, itemId: string) => {
    try {
      // If single choice, uncheck others
      if (itemType === "single_choice" && !option.isCorrect) {
        const item = assessment.items.find((i: any) => i.id === itemId);
        const updates = item.options.map((opt: any) => 
          updateAssessmentOption(opt.id, { isCorrect: opt.id === option.id })
        );
        await Promise.all(updates);
      } else {
        await updateAssessmentOption(option.id, { isCorrect: !option.isCorrect });
      }
      loadAssessment();
    } catch (err) {
      console.error(err);
    }
  };

  const updateOptionText = (optionId: string, text: string) => {
    // Update local state immediately
    setAssessment((prev: any) => ({
      ...prev,
      items: prev.items.map((item: any) => ({
        ...item,
        options: item.options.map((opt: any) => 
          opt.id === optionId ? { ...opt, text } : opt
        )
      }))
    }));

    // Debounce server update
    const key = `opt-${optionId}`;
    if (saveTimeoutRef.current[key]) clearTimeout(saveTimeoutRef.current[key]);
    
    saveTimeoutRef.current[key] = setTimeout(async () => {
      setSaving(true);
      try {
        await updateAssessmentOption(optionId, { text });
      } catch (err) {
        console.error(err);
      } finally {
        setSaving(false);
        delete saveTimeoutRef.current[key];
      }
    }, 1000);
  };

  const moveItem = async (idx: number, dir: "up" | "down") => {
    const newItems = [...assessment.items];
    const targetIdx = dir === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= newItems.length) return;
    
    // Swap
    [newItems[idx], newItems[targetIdx]] = [newItems[targetIdx], newItems[idx]];
    
    // Update locally
    setAssessment((prev: any) => ({ ...prev, items: newItems }));
    
    // Sync to DB
    try {
      await updateAssessmentItemsOrder(newItems.map((it, i) => ({ id: it.id, order: i })));
    } catch (err) {
      console.error(err);
      loadAssessment();
    }
  };

  if (loading || !resolvedParams) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 bg-slate-50 dark:bg-slate-950">
        <Loader2 className="h-10 w-10 text-primary animate-spin" />
      </div>
    );
  }

  if (!assessment) {
    return (
      <div className="flex-1 p-8 text-center bg-slate-50 dark:bg-slate-950">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Assessment not found</h2>
        <Link href={`/courses/${resolvedParams.programId}`} className="text-primary hover:underline mt-4 inline-block">Back to Program</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 md:px-8 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          <MobileMenuButton />
          <Link
            href={`/courses/${resolvedParams.programId}`}
            className="p-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-slate-400 rounded-lg transition-colors flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Assessment Editor</span>
            <div className="flex items-center gap-2">
              <h1 className="text-sm md:text-lg font-black text-slate-900 dark:text-white tracking-tight leading-none uppercase truncate">
                {assessment.name}
              </h1>
              {saving && <Loader2 className="h-3.5 w-3.5 text-primary animate-spin flex-shrink-0" />}
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto p-8 space-y-8">
          {assessment.items.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-12 text-center border-2 border-dashed border-slate-200 dark:border-slate-800">
               <Type className="h-12 w-12 text-slate-300 dark:text-slate-700 mx-auto mb-4" />
               <h3 className="text-xl font-bold text-slate-900 dark:text-white">Empty Assessment</h3>
               <p className="text-slate-500 mb-8 max-w-sm mx-auto">Start by adding questions using the controls below. You can mix different types of questions.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {assessment.items.map((item: any, idx: number) => (
                <div key={item.id} className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden group hover:shadow-md transition-all">
                  <div className="p-1 px-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                     <div className="flex items-center gap-4">
                        <div className="flex flex-col">
                           <button onClick={() => moveItem(idx, "up")} disabled={idx === 0} className="p-0.5 text-slate-300 hover:text-primary disabled:opacity-0"><ChevronUp className="h-3 w-3" /></button>
                           <button onClick={() => moveItem(idx, "down")} disabled={idx === assessment.items.length - 1} className="p-0.5 text-slate-300 hover:text-primary disabled:opacity-0"><ChevronDown className="h-3 w-3" /></button>
                        </div>
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded">Q{idx + 1} • {item.type.replace('_', ' ')}</span>
                     </div>
                     <button 
                       onClick={() => deleteItem(item.id)}
                       className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg transition-colors"
                     >
                       <Trash2 className="h-3.5 w-3.5" />
                     </button>
                  </div>
                  
                  <div className="p-8 space-y-6">
                    <div>
                      <textarea
                        value={item.questionText}
                        onChange={(e) => updateItemText(item.id, e.target.value)}
                        placeholder="Type your question here..."
                        className="w-full text-xl font-bold bg-transparent text-slate-900 dark:text-white border-none focus:ring-0 placeholder:text-slate-300 dark:placeholder:text-slate-700 resize-none p-0"
                        rows={2}
                      />
                    </div>

                    {item.type !== "free_text" && (
                      <div className="space-y-3">
                        {item.options.map((opt: any) => (
                          <div key={opt.id} className="flex items-center gap-3 group/option">
                            <button
                              onClick={() => toggleCorrect(opt, item.type, item.id)}
                              className={`p-2 rounded-xl border-2 transition-all ${
                                opt.isCorrect 
                                  ? "bg-emerald-500 border-emerald-500 text-white" 
                                  : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-300"
                              }`}
                            >
                              {item.type === "single_choice" ? (
                                opt.isCorrect ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />
                              ) : (
                                opt.isCorrect ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />
                              )}
                            </button>
                            <input
                              type="text"
                              value={opt.text}
                              onChange={(e) => updateOptionText(opt.id, e.target.value)}
                              className="flex-1 bg-transparent border-b border-transparent focus:border-primary text-slate-700 dark:text-slate-300 focus:outline-none py-1 transition-all"
                            />
                            <button 
                              onClick={() => deleteOption(opt.id)}
                              className="p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover/option:opacity-100 transition-all"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => addOption(item.id)}
                          className="flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-primary transition-colors py-2"
                        >
                          <Plus className="h-4 w-4" /> Add Option
                        </button>
                      </div>
                    )}

                    {item.type === "free_text" && (
                      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/30 border-2 border-dashed border-slate-200 dark:border-slate-700 text-center">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Free Text Response Block</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-8 shadow-sm">
             <h4 className="text-sm font-black text-slate-400 uppercase tracking-[0.2em] mb-6 text-center">Add Question Item</h4>
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button 
                  onClick={() => addItem("single_choice")}
                  className="flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-slate-100 dark:border-slate-800 hover:border-primary hover:bg-primary/5 transition-all group"
                >
                  <div className="w-10 h-10 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-400 group-hover:text-primary flex items-center justify-center transition-colors">
                    <Circle className="h-6 w-6" />
                  </div>
                  <span className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">Single Choice</span>
                </button>
                <button 
                  onClick={() => addItem("multiple_choice")}
                  className="flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-slate-100 dark:border-slate-800 hover:border-primary hover:bg-primary/5 transition-all group"
                >
                  <div className="w-10 h-10 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-400 group-hover:text-primary flex items-center justify-center transition-colors">
                    <CheckSquare className="h-6 w-6" />
                  </div>
                  <span className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">Multi Choice</span>
                </button>
                <button 
                  onClick={() => addItem("free_text")}
                  className="flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-slate-100 dark:border-slate-800 hover:border-primary hover:bg-primary/5 transition-all group"
                >
                  <div className="w-10 h-10 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-400 group-hover:text-primary flex items-center justify-center transition-colors">
                    <Type className="h-6 w-6" />
                  </div>
                  <span className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">Free Text</span>
                </button>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
