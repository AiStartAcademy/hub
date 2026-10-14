// Shared vocabulary for ProgramMaterial rows. Lives outside the courses
// "use server" actions file because Next production builds reject non-async
// exports from server-action modules (dev-mode Turbopack tolerates them).
export const MATERIAL_TYPES = ["pdf", "link", "document"] as const;
export type MaterialType = (typeof MATERIAL_TYPES)[number];
