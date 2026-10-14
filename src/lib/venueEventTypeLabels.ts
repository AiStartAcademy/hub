export const VENUE_EVENT_TYPES = [
  "NETWORKING",
  "HACKATHON",
  "WORKSHOP",
  "MEETUP",
  "INTERVIEW",
  "PODCAST",
  "PANEL",
  "DEMO_DAY",
  "KIDS_PROGRAM",
  "MOVIE_CLUB",
  "OTHER",
] as const;

export type VenueEventType = (typeof VENUE_EVENT_TYPES)[number];

export const VENUE_EVENT_TYPE_SET: ReadonlySet<string> = new Set(VENUE_EVENT_TYPES);

export function formatVenueEventTypeLabel(type: string): string {
  switch (type) {
    case "NETWORKING":
      return "Networking";
    case "HACKATHON":
      return "Hackathon";
    case "WORKSHOP":
      return "Workshop";
    case "MEETUP":
      return "Meetup";
    case "INTERVIEW":
      return "Interview";
    case "PODCAST":
      return "Podcast";
    case "PANEL":
      return "Panel";
    case "DEMO_DAY":
      return "Demo Day";
    case "KIDS_PROGRAM":
      return "Kids Program";
    case "MOVIE_CLUB":
      return "Movie Club";
    case "OTHER":
      return "Other";
    default:
      return type.replace(/_/g, " ");
  }
}
