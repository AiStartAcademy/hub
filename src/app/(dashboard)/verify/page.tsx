// src/app/(dashboard)/verify/page.tsx
"use client";

import { useState, useEffect, Suspense } from "react";
import { brand } from "@/config/brand";
import { Search, ShieldCheck, XCircle, Loader2, Award, Calendar, User, BookOpen, Download } from "lucide-react";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { useSearchParams, useRouter } from "next/navigation";

interface VerificationResult {
  valid: boolean;
  error?: string;
  certificate?: {
    id: string;
    pdfUrl: string | null;
    pngUrl: string | null;
    studentName: string;
    cohortName: string;
    issuedAt: string;
    cohortStartDate?: string | null;
    cohortEndDate?: string | null;
  };
}

function VerifyContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [certId, setCertId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState("");
  const [hasAutoSearched, setHasAutoSearched] = useState(false);

  // Shared verification logic
  const performVerification = async (idToVerify: string) => {
    if (!idToVerify.trim()) return;
    
    setLoading(true);
    setError("");
    setResult(null);
    
    try {
      const res = await fetch(`/api/certificates/verify?id=${encodeURIComponent(idToVerify.trim())}`);
      const data = await res.json();
      
      if (res.ok) {
        if (data.error && !data.certificate) {
          setError(data.error);
        } else {
          setResult(data);
        }
      } else {
        setError(data.error || "Failed to verify certificate");
      }
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Read query params on first load
  useEffect(() => {
    const queryId = searchParams.get("id");
    if (queryId && !hasAutoSearched) {
      setCertId(queryId.toUpperCase());
      performVerification(queryId);
      setHasAutoSearched(true);
    }
  }, [searchParams, hasAutoSearched]);

  // Manual lookup via the form
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!certId.trim()) return;

    // Update the query param so the URL is shareable
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("id", certId.trim().toUpperCase());
    router.replace(newUrl.pathname + newUrl.search);

    await performVerification(certId);
  };

  return (
    <div className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-950 p-4 sm:p-8 flex flex-col items-center">
      {/* Container max-w increased for desktop to fit everything gracefully */}
      <div className="w-full max-w-xl md:max-w-2xl lg:max-w-3xl bg-white dark:bg-slate-900 rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-slate-200 dark:border-slate-700 p-6 sm:p-10 my-8 sm:my-12 animate-fade-in relative z-10 transition-all">
        
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-primary/20">
            <ShieldCheck className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
            Certificate Check
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-sm mx-auto">
            Enter the unique 12-character ID to officially verify the authenticity of a student's certificate.
          </p>
        </div>

        <form onSubmit={handleVerify} className="space-y-4">
          <div>
            <label htmlFor="certId" className="sr-only">Certificate ID</label>
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-primary transition-colors" />
              <input
                id="certId"
                type="text"
                placeholder="e.g. A1B2-C3D4-E5F6"
                value={certId}
                onChange={(e) => setCertId(e.target.value.toUpperCase())}
                className="w-full pl-12 pr-4 py-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono text-center text-lg focus:outline-none focus:ring-4 focus:ring-primary/20 focus:border-primary transition-all uppercase placeholder:text-slate-400 placeholder:normal-case placeholder:text-base placeholder:font-sans"
                required
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={loading || !certId.trim()}
            className="w-full min-h-[52px] py-4 px-4 bg-primary hover:bg-primary-dark text-white rounded-xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 active:scale-[0.98]"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Check Registry"}
          </button>
        </form>

        {error && (
          <div className="mt-8 p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl flex items-start gap-3 animate-fade-in shadow-sm">
            <XCircle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-rose-700 dark:text-rose-400">Verification Failed</h3>
              <p className="text-sm text-rose-600 dark:text-rose-500 mt-1">{error}</p>
            </div>
          </div>
        )}

        {result && result.certificate && (
          <div className={`mt-8 p-4 sm:p-6 rounded-xl border-2 shadow-sm animate-fade-in ${result.valid ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800/50' : 'bg-rose-50 dark:bg-rose-900/10 border-rose-200 dark:border-rose-800/50'}`}>
            <div className="flex items-start gap-3 mb-6 pb-6 border-b border-black/10 dark:border-white/10">
              {result.valid ? (
                <ShieldCheck className="h-8 w-8 text-emerald-500 shrink-0" />
              ) : (
                <XCircle className="h-8 w-8 text-rose-500 shrink-0" />
              )}
              <div>
                <h3 className={`text-lg font-bold ${result.valid ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                  {result.valid ? 'Authentic Record Found' : 'Record Revoked'}
                </h3>
                <p className={`text-sm mt-1 leading-relaxed ${result.valid ? 'text-emerald-600 dark:text-emerald-500' : 'text-rose-600 dark:text-rose-500'}`}>
                  {result.valid 
                    ? `This certificate is legally valid and was officially issued under the ${brand.name} seal.`
                    : 'This certificate has been administratively revoked and is no longer valid.'}
                </p>
              </div>
            </div>

            <div className="space-y-3 sm:space-y-4">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1 flex items-center gap-3 sm:gap-4 bg-white dark:bg-slate-800 p-3 sm:p-4 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-slate-50 dark:bg-slate-700/50 flex items-center justify-center shrink-0 border border-slate-100 dark:border-slate-600">
                    <User className="h-5 w-5 sm:h-6 sm:w-6 text-slate-500 dark:text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-medium mb-0.5">Issued To</p>
                    <p className="text-sm sm:text-base font-bold text-slate-900 dark:text-white break-words">{result.certificate.studentName}</p>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-3 sm:gap-4 bg-white dark:bg-slate-800 p-3 sm:p-4 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-slate-50 dark:bg-slate-700/50 flex items-center justify-center shrink-0 border border-slate-100 dark:border-slate-600">
                  <BookOpen className="h-5 w-5 sm:h-6 sm:w-6 text-slate-500 dark:text-slate-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-medium mb-0.5">Program Title</p>
                  <p className="text-sm sm:text-base font-bold text-slate-900 dark:text-white break-words" title={result.certificate.cohortName}>
                    {result.certificate.cohortName}
                  </p>
                </div>
              </div>

              {/* 1 column on mobile, 2 columns on tablets/desktop */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                <div className="flex items-center gap-3 sm:gap-4 bg-white dark:bg-slate-800 p-3 sm:p-4 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-slate-50 dark:bg-slate-700/50 flex items-center justify-center shrink-0 border border-slate-100 dark:border-slate-600">
                    <Calendar className="h-5 w-5 sm:h-6 sm:w-6 text-slate-500 dark:text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-medium mb-0.5">
                      Cohort Dates
                    </p>
                    <p className="text-sm md:text-[15px] font-semibold text-slate-900 dark:text-white whitespace-nowrap overflow-hidden text-ellipsis md:overflow-visible">
                      {(() => {
                        const formatDate = (dateValue: string | Date) => 
                          new Date(dateValue).toLocaleDateString("en-US", { 
                            month: "short", day: "numeric", year: "numeric" 
                          });
                        
                        const start = result.certificate.cohortStartDate;
                        const end = result.certificate.cohortEndDate;
                        
                        if (start && end) {
                          return `${formatDate(start)} - ${formatDate(end)}`;
                        }
                        
                        return formatDate(result.certificate.issuedAt);
                      })()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 sm:gap-4 bg-white dark:bg-slate-800 p-3 sm:p-4 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-slate-50 dark:bg-slate-700/50 flex items-center justify-center shrink-0 border border-slate-100 dark:border-slate-600">
                    <Award className="h-5 w-5 sm:h-6 sm:w-6 text-slate-500 dark:text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-medium mb-0.5">
                      Certificate ID
                    </p>
                    <p className="text-sm md:text-[15px] font-mono font-semibold text-slate-900 dark:text-white whitespace-nowrap overflow-hidden text-ellipsis md:overflow-visible">
                      {result.certificate.id}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// useSearchParams needs a Suspense boundary for the build
export default function VerifyCertificatePage() {
  return (
    <>
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700/50 flex items-center px-4 md:px-8 flex-shrink-0 z-10 w-full">
        <MobileMenuButton />
        <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2 ml-2 md:ml-0">
          <ShieldCheck className="h-6 w-6 text-primary flex-shrink-0" />
          Verify Certificate
        </h1>
      </header>
      
      <Suspense fallback={
        <div className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-950 p-4 sm:p-8 flex flex-col items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      }>
        <VerifyContent />
      </Suspense>
    </>
  );
}
