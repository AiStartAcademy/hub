"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { enrollInProgram } from "../../actions";
import { useRouter } from "next/navigation";

export function EnrollButton({ programId }: { programId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleEnroll = async () => {
    setLoading(true);
    try {
      await enrollInProgram(programId);
      router.refresh();
    } catch (err: any) {
      alert(err.message || "Failed to enroll in the course.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleEnroll}
      disabled={loading}
      className="px-6 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-xl font-bold transition-all shadow-md shadow-primary/20 hover:shadow-lg flex items-center justify-center gap-2"
    >
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <>
          <Sparkles className="h-5 w-5 text-white/90" />
          Enroll to Access
        </>
      )}
    </button>
  );
}
