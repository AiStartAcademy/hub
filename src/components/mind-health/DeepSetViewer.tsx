"use client";

import type { MindHealthDeepSet, MindHealthExercise } from "@/types/mind-health";
import { useState, Fragment } from "react";
import { Star, Sparkles, Trophy, BookOpen, AlertCircle, ChevronDown, Eye, EyeOff } from "lucide-react";

interface Props {
  deepSet: MindHealthDeepSet;
  meta: any;
  loading: boolean;
}

export function DeepSetViewer({ deepSet, loading }: Props) {
  const [briefingOpen, setBriefingOpen] = useState(false);

  if (loading) {
    return (
      <div className="space-y-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-48 bg-slate-100 dark:bg-slate-800 rounded-3xl animate-pulse" />
        ))}
      </div>
    );
  }

  let currentCategory = "";

  return (
    <div className="space-y-10">
      
      {/* ── Briefing Accordion ── */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-all">
        <button 
          onClick={() => setBriefingOpen(!briefingOpen)}
          className="w-full flex items-center justify-between p-6 sm:p-8 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Sparkles className="h-6 w-6 text-indigo-500" />
            <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-wider">
              Mission Briefing
            </h2>
          </div>
          <ChevronDown className={`h-6 w-6 text-slate-400 transition-transform ${briefingOpen ? 'rotate-180' : ''}`} />
        </button>

        {briefingOpen && (
          <div className="animate-in slide-in-from-top-4 fade-in duration-200">
            <div className="p-6 sm:p-8 pt-0 text-left">
               <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
                {deepSet.description}
              </p>
              {deepSet.tracking_note && (
                <div className="mt-6 p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-900/30">
                  <p className="text-sm font-semibold text-indigo-800 dark:text-indigo-300">
                    🎯 {deepSet.tracking_note}
                  </p>
                </div>
              )}
            </div>
            <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-left">
              <TechniqueAccordion technique={deepSet.technique} />
            </div>
          </div>
        )}
      </div>

      {/* ── Exercises List with Centered Category Headers ── */}
      <div className="space-y-8">
        {deepSet.exercises.map((exercise, idx) => {
          const isNewCategory = exercise.category !== currentCategory;
          currentCategory = exercise.category;

          return (
            <Fragment key={idx}>
              {isNewCategory && (
                <div className="pt-8 pb-2 flex items-center justify-center">
                  <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                    <span className="w-2 h-2 rounded-full bg-current opacity-40" />
                    <span className="text-xs font-black uppercase tracking-widest">{exercise.category.replace(/_/g, " ")}</span>
                    <span className="w-2 h-2 rounded-full bg-current opacity-40" />
                  </div>
                </div>
              )}
              <ExerciseCard exercise={exercise} index={idx + 1} />
            </Fragment>
          );
        })}
      </div>

      {/* ── Challenge Exercise ── */}
      {deepSet.challenge_exercise && (
        <div className="mt-16">
          <div className="pb-6 flex items-center justify-center">
             <div className="inline-flex items-center gap-2 px-6 py-2 rounded-full bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-600 dark:text-amber-500 shadow-sm">
                <Star className="h-4 w-4 fill-current" />
                <span className="text-sm font-black uppercase tracking-widest">Boss Rank</span>
             </div>
          </div>
          <ChallengeCard exercise={deepSet.challenge_exercise} />
        </div>
      )}

      {/* ── Scoring Summary Footer ── */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-indigo-500 to-purple-600 p-[1px] mt-12">
        <div className="bg-white dark:bg-slate-950 rounded-[23px] px-6 py-10 text-center relative z-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-indigo-50 dark:bg-indigo-900/30 mb-5">
            <Trophy className="h-7 w-7 text-indigo-600 dark:text-indigo-400" />
          </div>
          <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-widest mb-3">
            Session Complete
          </h3>
          <p className="text-slate-600 dark:text-slate-400 font-medium max-w-lg mx-auto leading-relaxed">
            {deepSet.total_scoring}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function TechniqueAccordion({ technique }: { technique: MindHealthDeepSet["technique"] }) {
  return (
    <div className="px-6 sm:px-8 py-6">
      <div className="flex items-center gap-3 mb-6">
        <BookOpen className="h-5 w-5 text-indigo-500" />
        <span className="font-bold text-sm uppercase tracking-wider text-slate-900 dark:text-white">
          Active Technique: {technique.name}
        </span>
      </div>
      <div className="grid gap-6 md:grid-cols-2 text-sm pb-2">
        <div className="space-y-4">
          <div>
            <h4 className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">What it is</h4>
            <p className="text-slate-700 dark:text-slate-300 leading-relaxed font-medium">{technique.what_it_is}</p>
          </div>
          <div>
            <h4 className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">Science Background</h4>
            <p className="text-slate-500 dark:text-slate-400 leading-relaxed italic">{technique.science}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800/50 p-5 rounded-2xl border border-slate-200 dark:border-slate-800">
          <h4 className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-2">How to apply today</h4>
          <p className="text-slate-800 dark:text-slate-200 font-semibold leading-relaxed text-base">{technique.how_to_use_today}</p>
        </div>
      </div>
    </div>
  );
}

// ── Base Card  ──
function BaseCard({ 
  exercise, 
  index, 
  theme = "normal" 
}: { 
  exercise: MindHealthExercise, 
  index?: number, 
  theme?: "normal" | "challenge" 
}) {
  const [showAnswers, setShowAnswers] = useState(false);
  
  const isChallenge = theme === "challenge";
  const typeLabel = exercise.type.replace(/_/g, " ");

  const bgStyles = isChallenge 
    ? "bg-amber-50 dark:bg-slate-950 border-amber-200 dark:border-slate-800 text-slate-900 dark:text-white shadow-xl shadow-amber-500/10 isolate"
    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm group";

  const dividerStyle = isChallenge 
    ? "border-amber-200 dark:border-white/10" 
    : "border-slate-200 dark:border-slate-800";

  const titleStyles = isChallenge
    ? "text-2xl font-black capitalize text-amber-600 dark:text-transparent dark:bg-clip-text dark:bg-gradient-to-r dark:from-white dark:to-amber-100"
    : "text-xl font-bold text-slate-900 dark:text-white capitalize";

  const textStyles = isChallenge ? "text-slate-700 dark:text-slate-300" : "text-slate-600 dark:text-slate-300";
  const btnColor = isChallenge 
    ? "text-amber-700 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300 bg-amber-100/50 dark:bg-white/5 border-amber-200 dark:border-white/10" 
    : "text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10";

  return (
    <div className={`relative rounded-3xl border overflow-hidden flex flex-col ${bgStyles}`}>
      
      {!isChallenge && index !== undefined && (
         <div className="absolute -top-6 -right-4 text-[160px] font-black text-slate-50 dark:text-slate-800/20 leading-none select-none pointer-events-none z-0">
           {index}
         </div>
      )}
      {isChallenge && (
         <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 bg-amber-500/10 dark:bg-amber-500/20 blur-[100px] rounded-full pointer-events-none z-0" />
      )}

      {/* Main Container - Use flex-col md:flex-row to align columns */}
      <div className="relative z-10 p-6 sm:p-10 flex flex-col md:flex-row items-stretch">
        
        {/* Left Column: Instructions + Vertical Divider */}
        <div className={`md:w-[35%] shrink-0 flex flex-col w-full md:pr-10 border-b md:border-b-0 md:border-r pb-8 md:pb-0 mb-8 md:mb-0 ${dividerStyle}`}>
          <div className="mb-6">
            <h3 className={titleStyles}>{typeLabel}</h3>
          </div>
          <div className={`prose prose-sm font-medium leading-relaxed mb-10 ${textStyles}`}>
            <p>{exercise.instruction}</p>
          </div>
          
          {exercise.scoring && (
            <div className="group/tooltip relative self-start mt-auto">
              <button 
                className={`inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg border transition-colors cursor-help 
                  ${isChallenge ? 'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-500 border-amber-200 dark:border-amber-500/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'}`}
              >
                Grade Rule <AlertCircle className="h-3.5 w-3.5" />
              </button>
              <div className="absolute left-0 bottom-full mb-2 w-64 p-4 bg-slate-800 text-slate-200 text-xs font-medium rounded-xl border border-slate-700 shadow-2xl invisible opacity-0 translate-y-2 group-hover/tooltip:visible group-hover/tooltip:opacity-100 group-hover/tooltip:translate-y-0 transition-all z-20 pointer-events-none text-left">
                {exercise.scoring}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Task & Reveal Box */}
        <div className="md:w-[65%] w-full flex flex-col md:pl-10">
          
          {/* 1. Tasks section (No flex-grow here!) */}
          <div className="mb-8">
            {exercise.items && exercise.items.length > 0 && <SmartItemsRenderer items={exercise.items} theme={theme} />}
            {exercise.grid && <GridRenderer grid={exercise.grid} theme={theme} />}
            {exercise.data && !exercise.items && <ExerciseDataRenderer data={exercise.data} theme={theme} />}
          </div>

          {/* 2. Button and Answers Section */}
          <div>
            {(exercise.answers || exercise.sample_answers || exercise.data || exercise.pattern_explanation) && (
              <div className={`pt-6 border-t ${dividerStyle}`}>
                 <button
                  onClick={() => setShowAnswers(!showAnswers)}
                  className={`inline-flex items-center gap-2 text-sm font-bold transition-all px-5 py-2.5 rounded-xl border group ${btnColor}`}
                >
                  {showAnswers ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  {showAnswers ? "Hide Solution" : "Show Solution"}
                </button>
              </div>
            )}

            {/* Answers Box */}
            {showAnswers && (
               <div className={`mt-6 p-6 rounded-2xl border animate-in fade-in slide-in-from-top-2 duration-200 ${isChallenge ? 'bg-white dark:bg-amber-500/5 border-amber-200 dark:border-amber-500/20' : 'bg-indigo-50/50 dark:bg-indigo-900/10 border-indigo-100 dark:border-indigo-900/30'}`}>
                  <div className={`text-base font-mono space-y-3 ${isChallenge ? 'text-slate-800 dark:text-slate-200' : 'text-slate-800 dark:text-slate-200'}`}>
                    {renderAnswers(exercise, theme)}
                  </div>
                  {exercise.pattern_explanation && (
                    <div className={`mt-6 pt-5 border-t ${isChallenge ? 'border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-200' : 'border-indigo-200/50 dark:border-indigo-800/50 text-indigo-800 dark:text-indigo-300'}`}>
                      <p className="text-sm font-medium leading-relaxed">💡 Pattern: {exercise.pattern_explanation}</p>
                    </div>
                  )}
               </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

function ExerciseCard({ exercise, index }: { exercise: MindHealthExercise, index: number }) {
  return <BaseCard exercise={exercise} index={index} theme="normal" />;
}

function ChallengeCard({ exercise }: { exercise: MindHealthExercise }) {
  return <BaseCard exercise={exercise} theme="challenge" />;
}

// ── Smart Data Renderers (Fixed Matrix Highlighting) ──

function SmartItemsRenderer({ items, theme }: { items: string[], theme: string }) {
  const isChallenge = theme === "challenge";
  const bgColors = isChallenge 
    ? "bg-white dark:bg-white/5 border-amber-200 dark:border-white/10 text-slate-800 dark:text-slate-100" 
    : "bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/50 text-slate-800 dark:text-slate-200";

  const chunks: React.ReactNode[] = [];
  let tableRows: string[][] = [];

  const flushTable = () => {
    if (tableRows.length > 0) {
      chunks.push(
        <div key={`table-${chunks.length}`} className={`w-full overflow-x-auto rounded-xl border mb-6 mt-2 ${bgColors}`}>
          <table className="w-full text-center border-collapse">
            <tbody>
              {tableRows.map((row, ri) => (
                <tr key={ri} className={`border-b last:border-0 ${isChallenge ? 'border-amber-100 dark:border-white/10' : 'border-slate-200 dark:border-slate-700'}`}>
                  {row.map((cell, ci) => {
                    const isHeaderCell = ri === 0 || ci === 0;
                    
                    let cellClass = "";
                    if (isHeaderCell) {
                       cellClass = isChallenge 
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 font-black" 
                          : "bg-slate-200/50 dark:bg-slate-700/40 text-slate-600 dark:text-slate-400 font-black";
                    } else {
                       cellClass = isChallenge 
                          ? "text-slate-800 dark:text-white font-semibold" 
                          : "text-slate-800 dark:text-slate-200 font-semibold";
                    }

                    return (
                      <td key={ci} className={`px-4 py-3 font-mono text-sm border-r last:border-0 whitespace-nowrap ${cellClass} ${isChallenge ? 'border-amber-100 dark:border-white/10' : 'border-slate-200 dark:border-slate-700'}`}>
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableRows = [];
    }
  };

  items.forEach((rawItem, i) => {
    const item = rawItem.replace(/^\d+\.\s*/, "").trim();
    
    // Rows separated by pipe
    if (item.includes("|") && (item.toUpperCase().includes("ROW") || item.toUpperCase().includes("COL") || item.split("|").length > 2)) {
      let cells = item.split("|").map(s => s.trim());
      
      if (cells[0] === "" && item.startsWith("|")) cells.shift();
      if (cells[cells.length - 1] === "" && item.endsWith("|")) cells.pop();

      const isAllCols = cells.every(c => c === "" || /COL(UMN)?\s*\d+/i.test(c));
      if (isAllCols && cells.length > 0 && /COL(UMN)?\s*\d+/i.test(cells[0])) {
         cells.unshift(""); 
      }

      tableRows.push(cells);
    } 
    // Bold Headers (e.g., THE GRID)
    else if (item.toUpperCase().includes("THE GRID") || item.includes("---COVER")) {
      flushTable();
      chunks.push(<div key={i} className={`text-sm font-bold uppercase tracking-wide my-4 opacity-100 ${isChallenge ? 'text-amber-600 dark:text-amber-400' : 'text-indigo-600 dark:text-indigo-400'}`}>{item}</div>);
    }
    // Column Headers 
    else if (item.toUpperCase().includes("COL 1") && item.toUpperCase().includes("COL 2")) {
      const cols = item.match(/(COL|COLUMN)\s*\d+/gi);
      if (cols && cols.length > 1) {
        tableRows.push(["", ...cols]); 
      } else {
        chunks.push(<p key={i} className="mb-4 font-mono text-sm opacity-70">{item}</p>);
      }
    }
    // Questions
    else if (item.toLowerCase().startsWith("question")) {
      flushTable();
      chunks.push(
        <div key={i} className={`flex gap-4 p-4 rounded-xl border mb-3 last:mb-0 ${bgColors}`}>
          <span className="text-base font-semibold leading-relaxed">{item}</span>
        </div>
      );
    }
    // Regular text item
    else {
      flushTable();
      chunks.push(
        <div key={i} className={`flex items-start gap-4 p-4 rounded-xl border mb-3 last:mb-0 ${bgColors}`}>
          <span className="text-[10px] font-black opacity-40 mt-1.5 shrink-0">{i + 1}.</span>
          <span className="text-base font-mono font-medium leading-relaxed">{item}</span>
        </div>
      );
    }
  });

  flushTable();
  return <div className="w-full flex-1">{chunks}</div>;
}

function GridRenderer({ grid, theme }: { grid: string[][], theme: string }) {
  const isChallenge = theme === "challenge";
  return (
    <div className={`mb-6 overflow-x-auto rounded-2xl border ${isChallenge ? 'border-amber-200 dark:border-white/10 bg-white dark:bg-white/5' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'}`}>
      <table className="w-full border-collapse">
        <tbody>
          {grid.map((row, ri) => (
            <tr key={ri} className={`border-b last:border-0 ${isChallenge ? 'border-amber-100 dark:border-white/10' : 'border-slate-200 dark:border-slate-700'}`}>
              {row.map((cell, ci) => (
                <td key={ci} className={`border-r last:border-0 px-6 py-4 text-center font-mono font-bold whitespace-nowrap ${isChallenge ? 'border-amber-100 dark:border-white/10 text-slate-800 dark:text-white' : 'border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200'}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExerciseDataRenderer({ data, theme }: { data: Record<string, unknown>, theme: string }) {
  const skipKeys = new Set(["answers", "sample_answers"]);
  const entries = Object.entries(data).filter(([key]) => !skipKeys.has(key));
  if (entries.length === 0) return null;
  const isChallenge = theme === "challenge";

  return (
    <div className="space-y-4 flex-1">
      {entries.map(([key, value]) => (
        <div key={key} className={`p-4 rounded-xl border ${isChallenge ? 'bg-white dark:bg-white/5 border-amber-200 dark:border-white/10' : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/50'}`}>
          <span className={`block text-[10px] font-black uppercase tracking-widest mb-2 ${isChallenge ? 'text-amber-500/60' : 'text-slate-500'}`}>
            {key.replace(/_/g, " ")}
          </span>
          <div className="text-sm font-medium">
            {typeof value === "string" ? (
              <p className="whitespace-pre-line leading-relaxed">{value}</p>
            ) : Array.isArray(value) ? (
              <ul className="list-disc list-inside space-y-1">
                {value.map((item, i) => <li key={i}>{String(item)}</li>)}
              </ul>
            ) : (
              String(value)
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function renderAnswers(exercise: MindHealthExercise, theme: string) {
  const answers = exercise.answers ?? exercise.sample_answers ?? exercise.data?.answers;
  const isChallenge = theme === "challenge";
  
  if (Array.isArray(answers) && answers.length > 0) {
    return answers.map((a, i) => (
      <div key={i} className="flex items-baseline gap-3 mb-2 last:mb-0">
        <span className={`text-[10px] font-black w-6 text-right shrink-0 uppercase ${isChallenge ? 'text-amber-600 dark:text-amber-500/80' : 'text-indigo-500'}`}>A{i + 1}.</span> 
        <span className="text-sm sm:text-base font-semibold leading-relaxed">{String(a)}</span>
      </div>
    ));
  }
  
  return (
    <pre className="text-xs whitespace-pre-wrap opacity-80">
      {JSON.stringify(answers, null, 2)}
    </pre>
  );
}