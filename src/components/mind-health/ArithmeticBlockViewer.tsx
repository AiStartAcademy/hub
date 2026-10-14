"use client";

import { useState, useEffect } from "react";
import { Calculator, Eye, EyeOff, RefreshCw, Timer, Play, Square, RotateCcw, AlertCircle } from "lucide-react";
import type { MindHealthArithmeticBlock } from "@/types/mind-health";

interface Props {
  block: MindHealthArithmeticBlock;
}

export function ArithmeticBlockViewer({ block }: Props) {
  const [showAnswers, setShowAnswers] = useState(false);
  
  // Timer State
  const [time, setTime] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    if (isRunning) {
      intervalId = setInterval(() => setTime((t) => t + 1), 1000);
    }
    return () => clearInterval(intervalId);
  }, [isRunning]);

  const toggleTimer = () => setIsRunning(!isRunning);
  const resetTimer = () => { setIsRunning(false); setTime(0); };
  
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const items = block.items ?? [];
  const answers = block.answers ?? [];

  const columns = 4;
  const rowsPerCol = Math.ceil(items.length / columns);
  const grid: string[][] = [];
  for (let c = 0; c < columns; c++) {
    grid.push(items.slice(c * rowsPerCol, (c + 1) * rowsPerCol));
  }

  return (
    <section className="relative overflow-hidden rounded-3xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm border border-slate-200 dark:border-slate-800 isolate transition-colors duration-200">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-[0.03] dark:opacity-[0.03] pointer-events-none" 
           style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, currentColor 1px, transparent 0)', backgroundSize: '24px 24px' }}>
      </div>

      <div className="p-6 sm:p-10">
        {/* ── Header ── */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8 mb-10 relative z-10 w-full">
          <div className="flex items-start gap-5 flex-1">
            <div className="shrink-0 w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-500/20 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-center">
              <Calculator className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="w-full mt-1">
              <span className="inline-block text-[10px] font-bold tracking-widest text-emerald-700 dark:text-emerald-400 uppercase bg-emerald-100 dark:bg-emerald-500/10 px-2 py-0.5 rounded-full mb-3">
                Warm-up
              </span>
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 dark:text-white mb-3">
                Arithmetic Speed Grid
              </h2>
              <div className="flex flex-col gap-2">
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl font-medium">
                  {block.instruction}
                </p>
                {block.time_target && (
                  <p className="text-sm text-emerald-600 dark:text-emerald-500/80 font-bold flex items-center gap-1.5 mt-2">
                    <Timer className="h-4 w-4" /> Goal: {block.time_target}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Problems Grid ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-12 gap-y-3 relative z-10 w-full mb-10">
          {grid.map((colProblems, colIdx) => (
            <div key={colIdx} className="space-y-2">
              {colProblems.map((problem, rowIdx) => {
                const globalIdx = colIdx * rowsPerCol + rowIdx;
                if (!problem) return null;
                const answer = answers[globalIdx];
                const isAnswerRevealed = showAnswers && answer !== undefined;

                return (
                  <div
                    key={`${colIdx}-${rowIdx}`}
                    className="group flex items-center justify-between py-2 border-b border-slate-200 dark:border-slate-800/50 hover:border-slate-300 dark:hover:border-slate-700 transition-colors h-[44px]"
                  >
                    <div className="flex items-baseline gap-4 h-full overflow-hidden">
                      <span className="text-[10px] font-mono text-slate-400 dark:text-slate-600 w-5 text-right shrink-0 select-none">
                        {globalIdx + 1}
                      </span>
                      <span className="text-[17px] font-mono font-medium text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors tracking-widest whitespace-nowrap">
                        {typeof problem === "object" ? JSON.stringify(problem) : String(problem)}
                      </span>
                    </div>
                    {/* Fixed container width for answers to prevent jumping layout */}
                    <div className="w-16 shrink-0 text-right h-full flex items-center justify-end">
                      {isAnswerRevealed ? (
                        <span className="text-base font-black font-mono text-emerald-600 dark:text-emerald-400 animate-in fade-in zoom-in duration-200">
                          {answer}
                        </span>
                      ) : (
                        <span className="h-[2px] w-full bg-slate-200 dark:bg-slate-800 rounded-full inline-block" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* ── Footer ── */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6 pt-6 border-t border-slate-200 dark:border-slate-800/60 relative z-10 w-full">
          
          <div className="flex items-center gap-4 w-full sm:w-auto">
             {/* Interactive Timer */}
             <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-1 shadow-inner shrink-0">
                <div className="px-3 py-1 text-lg font-black font-mono text-slate-800 dark:text-white tracking-widest min-w-[80px] text-center">
                  {formatTime(time)}
                </div>
                <div className="flex gap-1 border-l border-slate-300 dark:border-slate-800 pl-1">
                  <button 
                    onClick={toggleTimer}
                    className={`p-1.5 rounded-lg transition-colors ${isRunning ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'}`}
                  >
                    {isRunning ? <Square className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
                  </button>
                  <button 
                    onClick={resetTimer} 
                    className="p-1.5 rounded-lg bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                </div>
              </div>

            <p className="text-xs text-slate-500 font-medium flex items-center gap-2 hidden lg:flex whitespace-nowrap">
              <RefreshCw className="h-3.5 w-3.5" /> Calculate on paper, then check solutions.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-end w-full sm:w-auto gap-4">
            {/* 1. Scoring Guide */}
            {block.scoring && (
              <div className="relative group inline-block w-full sm:w-auto text-right sm:text-left">
                <button className="text-xs font-bold text-slate-600 dark:text-slate-400 dark:hover:text-white uppercase tracking-widest bg-slate-100 dark:bg-slate-800/50 hover:bg-slate-200 dark:hover:bg-slate-800 px-4 py-3 sm:py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/50 transition-colors cursor-help w-full sm:w-auto flex items-center justify-center gap-2 whitespace-nowrap">
                  Grade Rule <AlertCircle className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                </button>
                <div className="absolute bottom-full right-0 mb-3 w-72 sm:w-80 p-5 bg-slate-800 text-slate-200 text-xs sm:text-sm font-medium rounded-xl border border-slate-700 shadow-2xl invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-all z-20 pointer-events-none text-left">
                  <p className="mb-2 font-bold text-slate-400 tracking-widest uppercase text-[10px]">Scoring Details</p>
                  {block.scoring}
                </div>
              </div>
            )}
            
            {/* 2. Show Solution - width is auto, whitespace-nowrap ensures single line */}
            <button
              onClick={() => setShowAnswers((v) => !v)}
              className="w-full sm:w-auto whitespace-nowrap inline-flex items-center justify-center gap-2 px-6 py-3 sm:py-2.5 rounded-xl text-sm font-bold bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 transition-transform active:scale-95 shadow-md shadow-black/10 border border-transparent dark:border-white/10"
            >
              {showAnswers ? <EyeOff className="h-4 w-4 shrink-0" /> : <Eye className="h-4 w-4 shrink-0" />}
              {showAnswers ? "Hide Solution" : "Show Solution"}
            </button>
          </div>
        </div>

      </div>
    </section>
  );
}