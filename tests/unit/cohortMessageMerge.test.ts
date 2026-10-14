import { describe, expect, it } from "bun:test";
import {
  COHORT_MESSAGE_MERGE_FIELDS,
  mergeFirstName,
  renderCohortMessageText,
  resolveCohortMessageMergeValues,
  type CohortMessageCohort,
} from "@/lib/cohortMessages/render";

describe("cohort message merge fields", () => {
  it("SC-13: exports the exact supported field list and replaces optional-space tokens", () => {
    expect(COHORT_MESSAGE_MERGE_FIELDS).toEqual([
      "firstName",
      "cohortName",
      "nextSessionDate",
      "sessionLink",
    ]);

    expect(
      renderCohortMessageText(
        "Hi { firstName } — {cohortName}; { nextSessionDate }; {sessionLink}",
        {
          firstName: "Ada",
          cohortName: "Agents 101",
          nextSessionDate: "09 SEP 2026 · 18:00 PDT",
          sessionLink: "https://zoom.us/j/123",
        }
      )
    ).toBe(
      "Hi Ada — Agents 101; 09 SEP 2026 · 18:00 PDT; https://zoom.us/j/123"
    );
  });

  it("SC-13: renders missing and null values empty while leaving unknown or wrong-case tokens untouched", () => {
    expect(
      renderCohortMessageText("{firstName}|{cohortName}|{nextSessionDate}|{foo}|{FirstName}", {
        firstName: null,
        cohortName: undefined,
      })
    ).toBe("|||{foo}|{FirstName}");
  });

  it("SC-13: applies escaping to values only, never to staff-authored template text", () => {
    const escape = (value: string) => `[${value.replaceAll("<", "&lt;")}]`;

    expect(
      renderCohortMessageText("<p>{firstName}</p> {cohortName}", {
        firstName: "<Ada>",
        cohortName: "Builders",
      }, { escape })
    ).toBe("<p>[&lt;Ada>]</p> [Builders]");

    expect(renderCohortMessageText("<{firstName}>", { firstName: null }, { escape })).toBe(
      "<>"
    );
  });

  it("SC-13: derives a safe first name and suppresses blank or placeholder names", () => {
    expect(mergeFirstName("  Ada Lovelace ")).toBe("Ada");
    expect(mergeFirstName(null)).toBe("");
    expect(mergeFirstName("   ")).toBe("");
    expect(mergeFirstName("lead")).toBe("");
    expect(mergeFirstName("GUEST")).toBe("");
  });

  it("SC-13: resolves the next unfinished session, inherits timezone, and falls back to the cohort link", () => {
    const cohort: CohortMessageCohort = {
      title: "Agent Builders",
      zoomLink: " https://zoom.us/j/cohort ",
      timezone: "ET",
      sessions: [
        {
          id: "past",
          date: new Date("2026-09-02T00:00:00.000Z"),
          startTime: "6:00 PM",
          endTime: "8:00 PM",
          timezone: null,
          meetingLink: "https://zoom.us/j/past",
        },
        {
          id: "later",
          date: new Date("2026-09-16T00:00:00.000Z"),
          startTime: "6:00 PM",
          endTime: "8:00 PM",
          timezone: null,
          meetingLink: "https://zoom.us/j/later",
        },
        {
          id: "next",
          date: new Date("2026-09-09T00:00:00.000Z"),
          startTime: "6:00 PM",
          endTime: "8:00 PM",
          timezone: null,
          meetingLink: "   ",
        },
      ],
    };

    expect(
      resolveCohortMessageMergeValues(
        cohort,
        { name: " Ada Lovelace " },
        new Date("2026-09-09T12:00:00.000Z")
      )
    ).toEqual({
      firstName: "Ada",
      cohortName: "Agent Builders",
      nextSessionDate: "09 SEP 2026 · 18:00 EDT",
      sessionLink: "https://zoom.us/j/cohort",
    });
  });

  it("SC-13: returns empty session fields when no session remains", () => {
    const cohort: CohortMessageCohort = {
      title: "Agent Builders",
      zoomLink: "https://zoom.us/j/cohort",
      timezone: "PT",
      sessions: [{
        id: "past",
        date: new Date("2026-09-02T00:00:00.000Z"),
        startTime: "6:00 PM",
        endTime: "8:00 PM",
        timezone: null,
        meetingLink: "https://zoom.us/j/past",
      }],
    };

    expect(
      resolveCohortMessageMergeValues(
        cohort,
        { name: "Guest" },
        new Date("2026-10-01T00:00:00.000Z")
      )
    ).toEqual({
      firstName: "",
      cohortName: "Agent Builders",
      nextSessionDate: "",
      sessionLink: "",
    });
  });
});
