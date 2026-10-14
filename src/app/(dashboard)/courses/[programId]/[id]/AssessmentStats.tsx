"use client";

import { useEffect, useState } from "react";
import { getSubmissions, getAssessment } from "../../actions";
import { 
  Users, 
  Clock, 
  CheckCircle, 
  AlertCircle, 
  ChevronRight,
  Loader2,
  Trophy
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

export default function AssessmentStats({ assessment }: { assessment: any }) {
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const searchParams = useSearchParams();
  const cohortId = searchParams.get("cohortId");

  useEffect(() => {
    if (cohortId) {
      getSubmissions(assessment.id, cohortId).then(data => {
        setSubmissions(data);
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, [assessment.id, cohortId]);

  if (!cohortId) {
    return (
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-8 rounded-3xl text-center">
         <AlertCircle className="h-10 w-10 text-amber-500 mx-auto mb-4" />
         <h2 className="text-xl font-bold text-amber-900 dark:text-amber-400">Missing Cohort Context</h2>
         <p className="text-sm text-amber-700 dark:text-amber-500 mt-2">To view submissions, please access this assessment through a specific cohort detail page.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const gradedCount = submissions.filter(s => s.status === 'graded').length;

  return (
    <div className="space-y-8 animate-fade-in">
       <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-8 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
             <div>
                <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-1">Results & Grading</h2>
                <h1 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tight leading-none">{assessment.name}</h1>
             </div>
             <div className="flex gap-4">
                <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 flex items-center gap-4">
                   <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                      <Users className="h-5 w-5" />
                   </div>
                   <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Submissions</p>
                      <p className="text-xl font-black text-slate-900 dark:text-white leading-none">{submissions.length}</p>
                   </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 flex items-center gap-4">
                   <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-500 flex items-center justify-center">
                      <CheckCircle className="h-5 w-5" />
                   </div>
                   <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Graded</p>
                      <p className="text-xl font-black text-slate-900 dark:text-white leading-none">{gradedCount}</p>
                   </div>
                </div>
             </div>
          </div>
       </div>

       <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <table className="w-full">
             <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700">
                   <th className="text-left py-4 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Student</th>
                   <th className="text-left py-4 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Submitted At</th>
                   <th className="text-left py-4 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                   <th className="text-left py-4 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Score</th>
                   <th className="text-right py-4 px-8"></th>
                </tr>
             </thead>
             <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {submissions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center">
                       <p className="text-sm text-slate-400 font-bold uppercase tracking-wider">No submissions yet.</p>
                    </td>
                  </tr>
                ) : (
                  submissions.map((sub) => (
                    <tr key={sub.id} className="group hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-all">
                       <td className="py-4 px-8">
                          <div className="flex items-center gap-3">
                             <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-500 uppercase overflow-hidden">
                                {sub.user.image ? <img src={sub.user.image} alt="" className="w-full h-full object-cover" /> : sub.user.name?.[0] || sub.user.email[0]}
                             </div>
                             <div>
                                <p className="text-sm font-bold text-slate-900 dark:text-white">{sub.user.name || "Student"}</p>
                                <p className="text-[10px] text-slate-400 font-bold">{sub.user.email}</p>
                             </div>
                          </div>
                       </td>
                       <td className="py-4 px-8 text-sm text-slate-500 font-medium">
                          {new Date(sub.createdAt).toLocaleString()}
                       </td>
                       <td className="py-4 px-8">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                             sub.status === 'graded' 
                               ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' 
                               : 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                          }`}>
                             {sub.status}
                          </span>
                       </td>
                       <td className="py-4 px-8 font-black text-slate-700 dark:text-slate-300">
                          {sub.totalScore !== null ? (
                             <div className="flex items-center gap-1.5">
                                <Trophy className="h-3.5 w-3.5 text-primary" />
                                <span>{sub.totalScore}</span>
                             </div>
                          ) : (
                             <span className="text-slate-300">—</span>
                          )}
                       </td>
                       <td className="py-4 px-8 text-right">
                          <Link 
                            href={`/courses/submissions/${sub.id}`}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-primary hover:text-white text-slate-600 dark:text-slate-400 text-xs font-black uppercase tracking-widest transition-all"
                          >
                             Review <ChevronRight className="h-3.5 w-3.5" />
                          </Link>
                       </td>
                    </tr>
                  ))
                )}
             </tbody>
          </table>
       </div>
    </div>
  );
}
