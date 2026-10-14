export interface LessonVideoTrack {
  language: string;
  videoUrl: string;
  isPrimary: boolean;
}

function orderTracks(tracks: LessonVideoTrack[]): LessonVideoTrack[] {
  return tracks
    .map((track, index) => ({ track, index }))
    .sort((left, right) => {
      const languageOrder = left.track.language.localeCompare(right.track.language);
      if (languageOrder !== 0) return languageOrder;
      return left.index - right.index;
    })
    .map(({ track }) => track);
}

export function resolveDefaultTrack(
  tracks: LessonVideoTrack[]
): LessonVideoTrack | null {
  const orderedTracks = orderTracks(tracks);

  // The original product note was ambiguous. We resolve it explicitly here:
  // primary wins, English is the fallback only when no primary exists.
  const primaryTrack = orderedTracks.find((track) => track.isPrimary);
  if (primaryTrack) return primaryTrack;

  const englishTrack = orderedTracks.find((track) => track.language === "en");
  if (englishTrack) return englishTrack;

  return orderedTracks[0] ?? null;
}
