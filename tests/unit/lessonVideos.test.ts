import { describe, expect, it } from "bun:test";
import {
  resolveDefaultTrack,
  type LessonVideoTrack,
} from "@/lib/lessonVideos";

describe("resolveDefaultTrack", () => {
  it("returns null for an empty track list", () => {
    expect(resolveDefaultTrack([])).toBeNull();
  });

  it("returns the only track when exactly one exists", () => {
    const track: LessonVideoTrack = {
      language: "ru",
      videoUrl: "videos/ru.mp4",
      isPrimary: false,
    };

    expect(resolveDefaultTrack([track])).toEqual(track);
  });

  it("prefers a primary track over English", () => {
    const englishTrack: LessonVideoTrack = {
      language: "en",
      videoUrl: "videos/en.mp4",
      isPrimary: false,
    };
    const primaryTrack: LessonVideoTrack = {
      language: "ru",
      videoUrl: "videos/ru.mp4",
      isPrimary: true,
    };

    expect(resolveDefaultTrack([englishTrack, primaryTrack])).toEqual(primaryTrack);
  });

  it("falls back to English when no primary track exists", () => {
    const frenchTrack: LessonVideoTrack = {
      language: "fr",
      videoUrl: "videos/fr.mp4",
      isPrimary: false,
    };
    const englishTrack: LessonVideoTrack = {
      language: "en",
      videoUrl: "videos/en.mp4",
      isPrimary: false,
    };

    expect(resolveDefaultTrack([frenchTrack, englishTrack])).toEqual(englishTrack);
  });

  it("picks deterministically when multiple primary tracks exist", () => {
    const russianPrimary: LessonVideoTrack = {
      language: "ru",
      videoUrl: "videos/ru.mp4",
      isPrimary: true,
    };
    const englishPrimary: LessonVideoTrack = {
      language: "en",
      videoUrl: "videos/en.mp4",
      isPrimary: true,
    };

    expect(resolveDefaultTrack([russianPrimary, englishPrimary])).toEqual(
      englishPrimary
    );
  });

  it("returns the stable first track when there is no primary and no English", () => {
    const spanishTrack: LessonVideoTrack = {
      language: "es",
      videoUrl: "videos/es.mp4",
      isPrimary: false,
    };
    const russianTrack: LessonVideoTrack = {
      language: "ru",
      videoUrl: "videos/ru.mp4",
      isPrimary: false,
    };

    expect(resolveDefaultTrack([russianTrack, spanishTrack])).toEqual(spanishTrack);
  });
});
