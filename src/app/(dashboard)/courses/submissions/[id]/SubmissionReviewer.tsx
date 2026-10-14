"use client";

import { useState } from "react";
import { 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Save, 
  Loader2,
  ChevronRight,
  Circle,
  Square,
  CheckSquare
} from "lucide-react";
import { gradeAnswer } from "../../actions";
import { useRouter } from "next/navigation";

export default function SubmissionReviewer({ submission }: { submission: any }) {
  const [grading, setGrading] = useState<string | null>(null);
  const router = useRouter();

  const handleGrade = async (answerId: string, points: number) => {
    setGrading(answerId);
    try {
      await gradeAnswer(answerId, points);
      router.refresh();
    } catch (err) {
      console.error(err);
      alert("Failed to grade answer");
    } finally {
      setGrading(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-24">
       <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-8 shadow-sm flex items-center justify-between">
          <div>
             <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-1">Grading Submission</h2>
             <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-sm font-bold text-slate-500 overflow-hidden">
                   {submission.user.image ? <img src={submission.user.image} alt="" className="w-full h-full object-cover" /> : submission.user.name?.[0] || submission.user.email[0]}
                </div>
                <div>
                   <p className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">{submission.user.name || "Student"}</p>
                   <p className="text-xs text-slate-500 font-bold">{submission.user.email}</p>
                </div>
             </div>
          </div>
          <div className="text-right">
             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Score</p>
             <p className="text-4xl font-black text-primary leading-none">
                {submission.totalScore !== null ? submission.totalScore : "—"}
                <span className="text-lg text-slate-300 ml-1">/ {submission.assessment.items.length}</span>
             </p>
          </div>
       </div>

       <div className="space-y-6">
          {submission.answers.map((ans: any, idx: number) => {
            const item = ans.item;
            return (
              <div key={ans.id} className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden animate-fade-in" style={{ animationDelay: `${idx * 0.1}s` }}>
                <div className="p-1 px-6 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                   <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Question {idx + 1} • {item.type.replace('_', ' ')}</span>
                   <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Points:</span>
                      <span className={`text-xs font-black ${ans.points === 1 ? 'text-emerald-500' : ans.points === 0 ? 'text-red-500' : 'text-slate-400'}`}>
                         {ans.points !== null ? ans.points : "Not graded"}
                      </span>
                   </div>
                </div>

                <div className="p-8 space-y-6">
                   <h3 className="text-lg font-bold text-slate-900 dark:text-white">{item.questionText}</h3>

                   {item.type === "free_text" ? (
                     <div className="space-y-4">
                        <div className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
                           <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Student Answer:</p>
                           <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{ans.textAnswer || <span className="italic text-slate-400">No answer provided</span>}</p>
                        </div>
                        <div className="flex gap-2">
                           <button
                             onClick={() => handleGrade(ans.id, 1)}
                             disabled={grading === ans.id}
                             className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all ${
                               ans.points === 1 
                                 ? 'bg-emerald-500 text-white' 
                                 : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 hover:bg-emerald-500 hover:text-white'
                             }`}
                           >
                              {grading === ans.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                              Correct (1 pt)
                           </button>
                           <button
                             onClick={() => handleGrade(ans.id, 0)}
                             disabled={grading === ans.id}
                             className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all ${
                               ans.points === 0 
                                 ? 'bg-red-500 text-white' 
                                 : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 hover:bg-red-500 hover:text-white'
                             }`}
                           >
                              {grading === ans.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                              Incorrect (0 pt)
                           </button>
                        </div>
                     </div>
                   ) : (
                     <div className="space-y-2">
                        {item.options.map((opt: any) => {
                          const isSelected = ans.selectedOptions.some((so: any) => so.optionId === opt.id);
                          return (
                            <div 
                              key={opt.id} 
                              className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${
                                opt.isCorrect 
                                  ? 'bg-emerald-50/30 border-emerald-200 dark:border-emerald-900/30' 
                                  : isSelected && !opt.isCorrect 
                                     ? 'bg-red-50/30 border-red-200 dark:border-red-900/30'
                                     : 'bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800'
                              }`}
                            >
                               <div className="flex items-center gap-3">
                                  <div className={`p-1 ${isSelected ? 'text-primary' : 'text-slate-300'}`}>
                                     {item.type === "single_choice" ? <Circle className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                                  </div>
                                  <span className={`font-medium ${isSelected ? 'text-slate-900 dark:text-white' : 'text-slate-400'}`}>{opt.text}</span>
                               </div>
                               <div className="flex items-center gap-2">
                                  {isSelected && (
                                     <span className="text-[10px] font-black text-primary uppercase tracking-widest bg-primary/10 px-2 py-0.5 rounded">Selected</span>
                                  )}
                                  {opt.isCorrect && (
                                     <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest bg-emerald-500/10 px-2 py-0.5 rounded">Correct Answer</span>
                                  )}
                               </div>
                            </div>
                          );
                        })}
                        <div className="pt-4 flex items-center gap-2">
                           <AlertCircle className="h-3.5 w-3.5 text-slate-400" />
                           <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Auto-graded by system</p>
                        </div>
                     </div>
                   )}
                </div>
              </div>
            );
          })}
       </div>
    </div>
  );
}
