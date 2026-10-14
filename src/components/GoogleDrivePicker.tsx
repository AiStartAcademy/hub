"use client";

import { useEffect, useRef, useState } from "react";
import { HardDriveUpload, Loader2 } from "lucide-react";

interface GoogleDrivePickerProps {
  onImport: (url: string) => void;
  disabled?: boolean;
}

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

export default function GoogleDrivePicker({ onImport, disabled }: GoogleDrivePickerProps) {
  const [loading, setLoading] = useState(false);
  const [gapiReady, setGapiReady] = useState(false);
  const pickerApiLoaded = useRef(false);
  const tokenClientRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;

    const loadScript = (src: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) {
          // Script tag exists but may still be loading — wait for it
          if ((existing as HTMLScriptElement).dataset.loaded === "1") {
            resolve();
          } else {
            existing.addEventListener("load", () => resolve());
            existing.addEventListener("error", () => reject());
          }
          return;
        }
        const script = document.createElement("script");
        script.src = src;
        script.onload = () => {
          script.dataset.loaded = "1";
          resolve();
        };
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.body.appendChild(script);
      });

    Promise.all([
      loadScript("https://apis.google.com/js/api.js"),
      loadScript("https://accounts.google.com/gsi/client"),
    ]).then(() => {
      if (cancelled || !window.gapi) return;
      window.gapi.load("picker", () => {
        if (!cancelled) {
          pickerApiLoaded.current = true;
          setGapiReady(true);
        }
      });
    }).catch((err) => {
      console.error("Failed to load Google APIs:", err);
    });

    return () => { cancelled = true; };
  }, []);

  const openPicker = (accessToken: string) => {
    if (!pickerApiLoaded.current) return;

      const videoMimeTypes = "video/mp4,video/webm,video/quicktime,video/x-msvideo,video/mpeg,video/x-flv,video/ogg,application/vnd.google-apps.video";

      const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
        .setIncludeFolders(true)
        .setMimeTypes(videoMimeTypes);

      const sharedView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
        .setOwnedByMe(false)
        .setIncludeFolders(true)
        .setMimeTypes(videoMimeTypes);

      const picker = new window.google.picker.PickerBuilder()
        .addView(view)
        .addView(sharedView)
        .setOAuthToken(accessToken)
        .setDeveloperKey(process.env.NEXT_PUBLIC_GOOGLE_API_KEY!)
        .setCallback(async (data: any) => {
          if (data.action !== window.google.picker.Action.PICKED) return;

          const file = data.docs[0];
          setLoading(true);
          try {
            const res = await fetch("/api/import-drive", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                fileId: file.id,
                fileName: file.name,
                mimeType: file.mimeType,
                accessToken,
              }),
            });
          const text = await res.text();
          let result: any;
          try {
            result = JSON.parse(text);
          } catch {
            throw new Error(`Server error (${res.status}): ${text.slice(0, 200)}`);
          }
          if (!res.ok) throw new Error(result.error || "Import failed");
          onImport(result.url);
        } catch (err: any) {
          alert("Drive import failed: " + err.message);
        } finally {
          setLoading(false);
        }
      })
      .build();

    picker.setVisible(true);
  };

  const handleClick = () => {
    if (!gapiReady || loading) return;

    // Initialize token client if not done yet
    if (!tokenClientRef.current) {
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
        scope: "https://www.googleapis.com/auth/drive.readonly",
        callback: (response: any) => {
          if (response.error) {
            alert("Google auth error: " + response.error);
            setLoading(false);
            return;
          }
          openPicker(response.access_token);
        },
      });
    }

    tokenClientRef.current.requestAccessToken({ prompt: "" });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || loading || !gapiReady}
      className="flex items-center gap-2 px-4 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold transition-all disabled:opacity-50"
      title="Import from Google Drive"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <HardDriveUpload className="h-4 w-4" />
      )}
      {loading ? "Importing..." : "From Drive"}
    </button>
  );
}
