// src/lib/drip/campaigns.ts
// The seeded academy drip library — four campaigns covering the lead lifecycle.
//
//   Priority  Campaign             Audience                        Job
//   ────────  ───────────────────  ──────────────────────────────  ─────────────────────────
//      5      qualified-close      status = QUALIFIED              close the seat
//     10      agency-launch        onboarding-quiz leads           quiz → cohort signup
//     20      thesaurus-followup   lead-magnet downloaders         asset → cohort interest
//     90      dormant-revive       NEW + 30 days inactive          last honest attempt
//
// Lowest priority wins when a lead matches several, and a lead holds only one
// active enrollment at a time (see engine.ts). The handoff between campaigns is
// `exitOnStatuses`: marking a nurture lead QUALIFIED exits them from the nurture
// track, and the next sweep picks them up in qualified-close.
//
// COPY RULES (repo conventions — see ../../CLAUDE.md):
//  · Every commercial CTA points at the hub's own /cohorts page ({{cohorts_url}}),
//    NOT at Luma. Signups run through the hub: it carries every format, the
//    membership tier, and guest checkout, and it is the surface we control.
//  · No prices in authored copy — pricing changes and hardcoded numbers go stale.
//    The one sanctioned exception is the live DB-backed
//    {{upcoming_cohorts}}/{{next_cohort}} merge output, because it cannot.
//  · No invented metrics, testimonials, or student outcomes.
//  · Outcome-first, founder-to-founder, no AI hype vocabulary.

import { brand } from "@/config/brand";
import { QA_EVENT_COHORT_ID, SELF_PACED_PROGRAM_ID } from "@/config/catalog";
import { content } from "@/config/content";

import type { DripSegment } from "./segment";
import type { StepChannel } from "./engine";

// Signups run through the hub, not Luma: /cohorts carries every format, the
// membership tier, and guest checkout, and it is the surface we control.
//
// Absolute, not the {{cohorts_url}} merge token — for now.
//
// sanitizeUrl() in ./admin.ts once returned null for any string `new URL()`
// could not parse, and normalizeDripStep then dropped BOTH ctaLabel and ctaUrl
// silently, so a token here wrote a step with no button at all. Four campaigns
// shipped to production that way before anyone noticed. sanitizeUrl now accepts
// url-kind merge tokens and warns on rejection, so the token is safe again —
// but the production database currently holds absolute URLs, and this constant
// stays absolute until that fix is deployed and the campaigns are re-pushed.
// Switching it earlier would put the seed and production out of sync.
const COHORTS = `${brand.urls.hub}/cohorts`;
const SELF_PACED = `${brand.urls.hub}/self-paced`;
const SELF_PACED_COURSE = `${brand.urls.hub}/courses/${SELF_PACED_PROGRAM_ID}`;
const MEMBER_CALLS = `${brand.urls.hub}/members/calls`;
const MEMBERSHIP = `${brand.urls.hub}/membership`;

// The free Q&A lead-magnet event. This is a specific cohort row, so it goes
// stale when that event is replaced — if the Q&A link 404s or points at a past
// event, re-point it at the current leadMagnet cohort on /cohorts.
const QA_EVENT = `${brand.urls.hub}/cohorts/${QA_EVENT_COHORT_ID}`;
const CONTACT_EMAIL = brand.email.contact;

export type SeedStep = {
  order: number;
  /** Hours to wait after the previous step (after enrollment, for order 1). */
  delayHours: number;
  /** ENROLLMENT (default) or COHORT_START — see prisma DripStep.anchor. */
  anchor?: "ENROLLMENT" | "COHORT_START";
  /** For COHORT_START: minutes relative to cohort start (negative = before). */
  offsetMinutes?: number;
  channel?: StepChannel;
  subject: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
};

import { CERTIFICATE_TRIGGER } from "./constants";

export type SeedCampaign = {
  slug: string;
  name: string;
  description: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED";
  /** LEAD_SEGMENT (default) or COHORT_SCHEDULE — see prisma DripCampaign.trigger. */
  trigger?: "LEAD_SEGMENT" | "COHORT_SCHEDULE" | typeof CERTIFICATE_TRIGGER;
  segment: DripSegment;
  autoEnroll: boolean;
  exitOnStatuses: string[];
  priority: number;
  timezone: string;
  sendWindowStartHour: number;
  sendWindowEndHour: number;
  skipWeekends: boolean;
  steps: SeedStep[];
};

const p = (text: string) => `<p style="margin:0 0 16px">${text}</p>`;
const h = (text: string) =>
  `<h2 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#1B1F3B">${text}</h2>`;
const ul = (items: string[]) =>
  `<ul style="margin:0 0 16px;padding-left:20px">${items
    .map((item) => `<li style="margin:0 0 8px">${item}</li>`)
    .join("")}</ul>`;
const signoff = (line = `— ${brand.founderFirstName}`) =>
  `<p style="margin:24px 0 0;color:#475569">${line}<br><span style="color:#94a3b8;font-size:14px">${brand.founderTitle}</span></p>`;

export function renderScholarshipCopy(
  scholarshipsPerCohort: number | undefined,
  copy: string,
): string {
  return scholarshipsPerCohort && scholarshipsPerCohort > 0 ? copy : "";
}

// ─────────────────────────────────────────────────────────────────────
// 1. Quiz leads → cohort signup. The main revenue path.
// ─────────────────────────────────────────────────────────────────────
const agencyLaunch: SeedCampaign = {
  slug: "agency-launch-nurture-v2-value-first",
  name: "Agency Launch Nurture v2 (value-first)",
  description: `Primary nurture for onboarding-quiz leads. Value-first (rev 2): every email teaches one usable lesson from the ${brand.shortName} workbook in full, then ends with the live cohort block. Exits on QUALIFIED so qualified-close can take over.`,
  status: "ACTIVE",
  segment: {
    sources: ["onboarding:*"],
    statuses: ["NEW", "CONTACTED"],
    noneTags: ["no-drip"],
  },
  autoEnroll: true,
  exitOnStatuses: ["QUALIFIED", "WON", "LOST"],
  priority: 10,
  timezone: brand.timezone,
  sendWindowStartHour: 8,
  sendWindowEndHour: 18,
  skipWeekends: false,
  steps: [
    {
      order: 1,
      delayHours: 0, // Immediate — teach while the quiz is still on their screen.
      subject: "{{first_name}}, how to pick what to automate (60-minute exercise)",
      body:
        h("Before any tool: pick the right task") +
        p(
          "Most first AI projects fail before a single tool is opened — the task was wrong. Stanford's WORKBank study scored 844 real work tasks and found most AI investment goes to tasks workers don't even want automated, while the tasks they do want gone sit untouched."
        ) +
        p("Here's the exercise we open the bootcamp with. It takes an hour and it's yours free:") +
        ul([
          "<strong>1. Inventory.</strong> Open last week's calendar. List 15 recurring tasks, 8 words each, with hours per week. Aim for 30+ total hours.",
          "<strong>2. Score each task twice.</strong> Desire: how much do you want it off your plate (1–5)? Capability: how well can today's AI actually do it (1–5)? Be honest on both — inflating either number produces a failed deployment.",
          "<strong>3. Zone it.</strong> High desire + high capability = <strong>Green Light</strong>: automate this week. High desire + low capability = R&amp;D: a future product. Low desire + high capability = your <strong>moat</strong> — the work that stays human on purpose. Low + low: stop thinking about it.",
          "<strong>4. Action list.</strong> Top three Green Light tasks, each with a named tool and a deploy date within 7 days. No tool you can name = not this week's task.",
        ]) +
        p(
          "One number worth computing: the share of your week that's Green Light. That's the time you can realistically get back this month."
        ) +
        p(
          "Reply with your #1 Green Light task if you want a tool suggestion — I read these myself. And if you'd rather work through this live, the schedule is below."
        ) +
        signoff(),
      ctaLabel: "See upcoming cohorts",
      ctaUrl: COHORTS,
    },
    {
      order: 2,
      delayHours: 48,
      subject: "The anatomy of a prompt that actually works",
      body:
        h("Same model, better words, different result") +
        p(
          "When output disappoints, people blame the model. Usually the prompt is just missing parts. A complete prompt has up to seven components — most people use one:"
        ) +
        ul([
          "<strong>Instruction</strong> — the action verb and the deliverable. “Summarize this email into three bullets.”",
          "<strong>Role</strong> — who the model is for this task. “You are a senior UX designer reviewing a checkout flow.”",
          "<strong>Context</strong> — the background it can't guess: your company, your audience, your constraints.",
          "<strong>Input data</strong> — the specific thing to act on, clearly separated from the instructions.",
          "<strong>Output indicator</strong> — the exact format: JSON, a table, 50 words, a given tone.",
          "<strong>Few-shot examples</strong> — one or two input→output pairs when the format keeps drifting.",
          "<strong>Guardrails</strong> — the edge cases: “if the answer is unclear, say 'insufficient data' rather than guessing.”",
        ]) +
        p(
          "One rule that fixes half of all misbehaving prompts: <strong>state what to do, not what not to do</strong>. “DON'T ask about preferences” is ambiguous; “if preferences are unknown, show today's top-100 list” is executable. Positive instructions specify the fallback — prohibitions make the model guess it."
        ) +
        p(
          "Try it today: take one prompt you use often, add a role and an output indicator, re-run it. That ten-minute upgrade is Day 1 material in the bootcamp — we go from here to full agent system prompts."
        ) +
        signoff(),
      ctaLabel: "See upcoming cohorts",
      ctaUrl: COHORTS,
    },
    {
      order: 3,
      delayHours: 72,
      subject: "Why your AI gets dumber the longer you use it",
      body:
        h("It's not the model. It's the context window.") +
        p(
          "Everyone's seen it: the AI is brilliant for an hour, then starts forgetting things you told it, contradicting itself, going vague. That's <strong>context rot</strong> — the window filled up, and quality degrades long before the hard limit. Models also read the start and end of the window hardest and skim the middle, so position matters as much as content."
        ) +
        p("The fix is four moves, and every serious AI system you'll ever meet is these four arranged in a loop:") +
        ul([
          "<strong>Compact</strong> — when a long session degrades, have the model summarize decisions-so-far into a note, start fresh, paste only the note.",
          "<strong>Offload</strong> — move detail into files; keep only the file names in the conversation.",
          "<strong>Isolate</strong> — give research its own session; carry over the conclusion, not the transcript.",
          "<strong>Retrieve</strong> — fetch information the moment it's needed instead of front-loading everything.",
        ]) +
        p(
          "And the cheapest habit in all of AI work: keep a <strong>context file</strong> — one short document per project with what it is, the conventions that matter, the decisions already made — and load it at the start of every session. Every correction you add is a mistake that never happens again."
        ) +
        p(
          "This is the skill that separates people who “use ChatGPT” from people who run agents for hours. It's a full session in the bootcamp — dates below if you want it hands-on."
        ) +
        signoff(),
      ctaLabel: "See upcoming cohorts",
      ctaUrl: COHORTS,
    },
    {
      order: 4,
      delayHours: 72,
      subject: "The doorbell pattern (how real automations start)",
      body:
        h("A webhook is a doorbell") +
        p(
          "The difference between “I use AI” and “I have an automation” is the trigger. An automation doesn't wait for you to open a chat — it starts itself when something happens. The mechanism is a <strong>webhook</strong>: a URL that an outside event can knock on. Your house doesn't check the front step every thirty seconds; it waits for the bell."
        ) +
        p("A concrete build you can copy — the voice-to-CRM pipeline:") +
        ul([
          "You speak to Siri: “Alex, one black shirt, medium, due Friday.”",
          "An Apple Shortcut POSTs the transcribed text to a webhook URL (n8n gives you one for free).",
          "An LLM node parses the free-form sentence into structured fields — name, product, quantity, deadline.",
          "A CRM node writes the record; a message comes back confirming it. No typing, no app, no data entry.",
        ]) +
        p(
          "Two traps everyone hits, so you don't have to: the model has no idea what today's date is — inject the current date into the prompt or “Friday” lands in the wrong week. And never leave a webhook URL unauthenticated — a public URL with no token is an open execution trigger."
        ) +
        p(
          "This exact pipeline is one of the builds in the bootcamp — you leave with it running on your own phone. Schedule below."
        ) +
        signoff(),
      ctaLabel: "See upcoming cohorts",
      ctaUrl: COHORTS,
    },
    {
      order: 5,
      delayHours: 96,
      subject: "“It worked in the demo” is not proof",
      body:
        h("Evals: the difference between believing and knowing") +
        p(
          "MIT found that ~95% of enterprise AI pilots deliver no measurable ROI. The proximate cause is almost never a weak model — it's that nobody defined what <em>working</em> means precisely enough to measure it. A demo is a single roll of a non-deterministic die."
        ) +
        p("The fix is called an eval, and a legitimate v1 takes one afternoon:") +
        ul([
          "<strong>1. Golden set.</strong> Collect ten real inputs your AI workflow handles. For each, write one sentence: what must a correct output contain? Real cases beat invented ones — and include the ugly ones, where the right answer is “I don't know.”",
          "<strong>2. Run and score.</strong> Pass/fail each output by hand. That pass rate is your baseline.",
          "<strong>3. Automate the mechanical half.</strong> Format checks, required fields, forbidden phrases — code can grade those.",
          "<strong>4. Re-run on every change.</strong> New prompt, cheaper model, new data source — if the number holds, ship. If it drops, you just caught a regression before your customers did.",
        ]) +
        p(
          "Every bug that shows up later becomes a new test case. Fixing a bug without adding the case invites it back."
        ) +
        p(
          "Almost nobody outside AI labs does this — which is exactly why it's in our curriculum. If you'd rather build your first eval suite with an instructor watching, dates below."
        ) +
        signoff(),
      ctaLabel: "See upcoming cohorts",
      ctaUrl: COHORTS,
    },
    {
      order: 6,
      delayHours: 96,
      subject: "The one formula that sells any automation",
      body:
        h("ROI, in one line") +
        p(
          "Whether you're pitching your boss, a client, or yourself, an automation is bought with arithmetic, not enthusiasm:"
        ) +
        p(
          "<strong>(Hours saved per week × hourly rate) × weeks per month − AI running costs = monthly ROI.</strong>"
        ) +
        p(
          "Example: a manual data-entry step eats 15 hours a week at $100/hour — $1,500 a month in labor. The automation's server and API tokens cost $150 a month. Net: $1,350 a month, every month. Divide any build cost by that number and you have the payback period. That's the whole pitch."
        ) +
        p(
          "When the bottleneck is throughput rather than labor, flip it: (revenue at new output volume − revenue at current volume) − AI costs. A sales team that can send 100 quotes instead of 50 doesn't save money — it makes more."
        ) +
        p(
          "And the honest counterpart: some automations have <em>negative</em> ROI. Over-engineering an already-efficient process, expensive models on tasks a cheap one handles, automating a step whose upstream data is broken. Run the numbers first — that discipline is what clients actually pay for."
        ) +
        renderScholarshipCopy(
          content.scholarshipsPerCohort,
          p(
            "In the bootcamp you'll run this math on your own tasks from the day-one audit. And if cost is the thing on your mind about the bootcamp itself: we hold two full scholarships per cohort — email " +
            `<a href="mailto:${CONTACT_EMAIL}" style="color:#7209B7">${CONTACT_EMAIL}</a>` +
            " and tell me your situation. I read those myself."
          ),
        ) +
        signoff(),
      ctaLabel: "See current dates and pricing",
      ctaUrl: COHORTS,
    },
    {
      order: 7,
      delayHours: 120,
      subject: "Last one from me, {{first_name}}",
      body:
        h("Six lessons, then I'll stop") +
        p(
          "This is the end of the sequence — I'd rather not clutter your inbox. Here's what the last three weeks covered, in one place:"
        ) +
        ul([
          "Pick tasks with the desire × capability audit — automate Green Light, protect your moat.",
          "Prompts have seven components; state what to do, not what not to do.",
          "When AI degrades, it's context rot — compact, offload, isolate, retrieve.",
          "Real automations start with a webhook, not a chat window.",
          "“Seems to work” isn't proof — ten real cases and a baseline number are.",
          "Hours saved × rate − AI costs: the one formula that sells any of it.",
        ]) +
        p(
          "That's a fair sample of the bootcamp — about one-tenth of it, honestly, and the reading-about-it version rather than the building-it version. The gap between people who talk about AI and people who deploy it is closing in favor of whoever has actually shipped something."
        ) +
        p(
          "If the timing is wrong, reply with the month that works and I'll flag the cohort when it opens. Otherwise — dates below, and thank you for reading this far."
        ) +
        signoff(),
      ctaLabel: "Take a seat",
      ctaUrl: COHORTS,
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────
// 1b. Goal-segmented quiz nurtures. Same value-first contract as the
// general arc — every email teaches one workbook lesson in full, the
// live cohort block closes every email — with nuggets picked for the
// lead's stated goal. Lower priority number = wins over the generic
// nurture (10). Reused steps borrow the general arc's body verbatim via
// generalStep(); fresh steps are authored per track.
// ─────────────────────────────────────────────────────────────────────

/** Borrow a step from the general arc (0-indexed), re-slotted. */
const generalStep = (
  index: number,
  order: number,
  delayHours: number,
  subject?: string
): SeedStep => ({
  ...agencyLaunch.steps[index],
  order,
  delayHours,
  ...(subject ? { subject } : {}),
});

const agencyTrack: SeedCampaign = {
  slug: "agency-track-nurture-v2-value-first",
  name: "Agency Track Nurture v2 (value-first)",
  description:
    "Value-first variant for leads tagged goal-agency: each email teaches one agency-business lesson from the workbook (sell the audit, ROI math, copy that converts, contracts), cohort block closes every email. Priority 7 outranks the generic nurture (10).",
  status: "ACTIVE",
  segment: {
    sources: ["onboarding:*"],
    statuses: ["NEW", "CONTACTED"],
    anyTags: ["goal-agency"],
    noneTags: ["no-drip"],
  },
  autoEnroll: true,
  exitOnStatuses: ["QUALIFIED", "WON", "LOST"],
  priority: 7,
  timezone: brand.timezone,
  sendWindowStartHour: 8,
  sendWindowEndHour: 18,
  skipWeekends: true,
  steps: [
    {
      order: 1,
      delayHours: 0,
      subject: "{{first_name}}, the first thing an AI agency sells (it isn't code)",
      body:
        h("Sell the audit, then build") +
        p(
          "The most common way a new automation agency dies: bidding on builds. You quote a system, the client half-describes the process, scope creeps, and you eat the difference. The fix is structural, and you can use it on client #1:"
        ) +
        ul([
          "<strong>Sell an AI audit as its own paid deliverable.</strong> A 60–90 minute live session where you map the client's process step by step — usually 8–12 steps — on a shared whiteboard.",
          "<strong>Collect friction as you go.</strong> Have their team mark each step green (fine) or red (painful, repetitive, error-prone). The red cluster is your build list, ranked by the client themselves.",
          "<strong>Deliver a document with standalone value:</strong> the annotated process map plus an automation spec any agency could implement. They can act on it even without you — which is exactly why they trust you with the build.",
          "<strong>Only then quote the build</strong> — against written specifications. No scope disputes, because the scope is on paper before a line of code exists.",
        ]) +
        p(
          "The rule we teach: <em>deliver the audit before writing a single line of code.</em> It positions you as the strategist, not the cheapest bidder — and the audit fee filters out clients who were never going to buy."
        ) +
        p(
          "Reply if you want the audit-session structure we use — happy to share it. And if you'd rather run one live with us, the schedule is below."
        ) +
        signoff(),
      ctaLabel: "See upcoming cohorts",
      ctaUrl: COHORTS,
    },
    {
      order: 2,
      delayHours: 48,
      subject: "The math that closes automation deals",
      body:
        h("Clients buy arithmetic, not enthusiasm") +
        p("Every automation proposal should end in one of these two lines:") +
        p(
          "<strong>Time-saved:</strong> (hours saved per week × the worker's hourly rate) × weeks per month − AI running costs = monthly ROI. Example: 15 hours/week of manual data entry at $100/hour is $1,500 a month; if the automation's infrastructure costs $150 a month, you're selling $1,350 of recurring value. Your fee divided by that number is the payback period — say that sentence out loud in the pitch."
        ) +
        p(
          "<strong>Revenue-generated:</strong> when the bottleneck is throughput, not labor: (revenue at new output volume − revenue at current volume) − AI costs. A sales team that can send 100 quotes a month instead of 50, at $200 average revenue per quote, isn't saving money — it's adding $10,000 a month of capacity."
        ) +
        p(
          "And the credibility move most sellers skip: name the <strong>negative-ROI traps</strong> up front. Over-engineering an already-efficient process. Premium models on tasks a cheap one handles. Automating a step whose upstream data is broken. Telling a client what <em>not</em> to automate is what makes them believe your numbers on what to automate."
        ) +
        p("In the bootcamp you run this math on a real process in week one. Dates below.") +
        signoff(),
      ctaLabel: "See upcoming cohorts",
      ctaUrl: COHORTS,
    },
    {
      order: 3,
      delayHours: 72,
      subject: "The landing-page mistake every new agency makes",
      body:
        h("Skill-based copy beats promise-based copy") +
        p(
          "Promise-based copy sells an outcome the visitor doesn't trust yet: “Launch your AI business.” “Build a six-figure agency.” It reads like network marketing, and skeptical buyers — the good ones — bounce."
        ) +
        p(
          "Skill-based copy names the specific competency: “Deploy AI agents in a production environment.” “Automate client workflows with n8n and Claude.” It attracts people already evaluating whether the skill is worth acquiring — higher intent — and the specificity itself is the credibility."
        ) +
        p(
          "We didn't take this on faith: we A/B-tested it on our own bootcamp landing page, and the skill-based variant won. Steal the method, not just the finding — two variants, equivalent traffic, the higher conversion rate wins. One test like this teaches you more about your offer than a month of opinions."
        ) +
        p(
          "Audit your own draft page tonight: circle every phrase that promises a transformation, and rewrite it as the skill that produces it."
        ) +
        signoff(),
      ctaLabel: "See upcoming cohorts",
      ctaUrl: COHORTS,
    },
    generalStep(3, 4, 72, "The build you can demo to any client (voice → CRM)"),
    {
      order: 5,
      delayHours: 96,
      subject: "Three contract clauses that save AI agencies",
      body:
        h("The legal part, before it's expensive") +
        p(
          "Not legal advice — but these three provisions come up in every real AI engagement, and standard dev contracts don't cover them:"
        ) +
        ul([
          "<strong>IP ownership.</strong> Say explicitly who owns the automations and code you build. Without an assignment clause, the default varies by jurisdiction and is rarely in your favor.",
          "<strong>Third-party AI disclosure.</strong> Everything you build on Claude or OpenAI passes client data through that provider. Name every provider in the contract and get consent — GDPR expects sub-processors listed; anything touching US medical data needs BAAs down the chain.",
          "<strong>Human-oversight liability.</strong> AI makes errors. The contract should state the client is responsible for keeping the agreed human review checkpoints — you are not liable for what happens when they bypass them.",
        ]) +
        p(
          "Worth adding: a non-solicitation clause (clients will try to hire your people once they see the work) — and one piece of anti-advice: <strong>don't register an LLC yet</strong>. A written service agreement is enough until the first client payment clears. Entity paperwork before revenue is friction, not progress."
        ) +
        p("The bootcamp's agency module walks a real engagement end to end — audit, spec, contract, build. Dates below.") +
        signoff(),
      ctaLabel: "See upcoming cohorts",
      ctaUrl: COHORTS,
    },
    generalStep(4, 6, 96, "Prove it works before the client asks"),
    {
      order: 7,
      delayHours: 120,
      subject: "Last one from me, {{first_name}}",
      body:
        h("The agency playbook, in six lines") +
        p("This is the end of the sequence. What the last three weeks covered:") +
        ul([
          "Sell the audit before writing code — strategy first, spec in writing.",
          "Price with the ROI formula; name the negative-ROI traps yourself.",
          "Skill-based copy beats promise-based copy — and A/B tests beat opinions.",
          "The voice-to-CRM pipeline: the demo that makes automation tangible for a buyer.",
          "Three contract clauses: IP, AI-provider disclosure, human-oversight liability.",
          "Evals: ten real cases and a baseline number, so “it works” is a fact, not a vibe.",
        ]) +
        p(
          "That's the reading version. The bootcamp is the building version — you leave with the stack deployed and the first-client playbook run at least once, with instructors who do this work for a living in the room."
        ) +
        p("If the timing is wrong, reply with the month that works and I'll flag the cohort when it opens.") +
        signoff(),
      ctaLabel: "Take a seat",
      ctaUrl: COHORTS,
    },
  ],
};

const careerTrack: SeedCampaign = {
  slug: "career-track-nurture-v2-value-first",
  name: "Career Track Nurture v2 (value-first)",
  description:
    "Value-first variant for leads tagged goal-career: each email teaches one workbook lesson framed as career leverage (moat score, prompting, context, portfolio of proof, evals), cohort block closes every email. Priority 8 outranks the generic nurture (10).",
  status: "ACTIVE",
  segment: {
    sources: ["onboarding:*"],
    statuses: ["NEW", "CONTACTED"],
    anyTags: ["goal-career"],
    noneTags: ["no-drip", "goal-agency"],
  },
  autoEnroll: true,
  exitOnStatuses: ["QUALIFIED", "WON", "LOST"],
  priority: 8,
  timezone: brand.timezone,
  sendWindowStartHour: 8,
  sendWindowEndHour: 18,
  skipWeekends: true,
  steps: [
    {
      order: 1,
      delayHours: 0,
      subject: "{{first_name}}, how automatable is your job? (there's a number)",
      body:
        h("Score your own week before someone else does") +
        p(
          "Here's a 60-minute exercise we run on day one of the bootcamp. It produces a number worth knowing about your own career:"
        ) +
        ul([
          "<strong>List 15 recurring tasks</strong> from last week's calendar, with hours per week. Aim for 30+ total hours.",
          "<strong>Score each twice:</strong> how much you'd want it automated (1–5), and how well today's AI can actually do it (1–5).",
          "<strong>Find your moat.</strong> The tasks where AI is capable but you'd keep them human — judgment calls, high-trust relationships, the work that makes you <em>you</em> at your job. Add up those hours plus everything AI can't do yet.",
        ]) +
        p(
          "That total, as a share of your week, is your <strong>Human Moat Score</strong>. Healthy is roughly 20–40%. Below 20% means much of your week is automatable and you should be the one automating it — before someone else does. Above 40% usually means you're doing work you could already be delegating to AI and reinvesting."
        ) +
        p(
          "Either way, the move is the same: automate your own Green Light tasks first, and become the person on your team who demonstrably did. Reply with your score if you compute it — I read these myself."
        ) +
        signoff(),
      ctaLabel: "See upcoming cohorts",
      ctaUrl: COHORTS,
    },
    generalStep(1, 2, 48),
    generalStep(2, 3, 72),
    generalStep(3, 4, 72, "Your first portfolio piece (voice → CRM, one evening)"),
    {
      order: 5,
      delayHours: 96,
      subject: "88% of companies “adopted AI.” 5% integrated it.",
      body:
        h("The gap is the career") +
        p(
          "Roughly 88% of companies now report some form of AI adoption. Independent research puts genuine integration into operational workflows at around 5–6% — and MIT's study of enterprise GenAI pilots found ~95% deliver no measurable ROI."
        ) +
        p(
          "Read that as a job seeker and it's the whole map: nearly every company has the tools and the mandate, and almost none has a person who can take a process from “we pay for Copilot” to “this runs in production and here's the number it moved.” The résumé line that gets calls isn't “familiar with AI tools” — it's “automated X, saving Y hours a month, measured.”"
        ) +
        p(
          "That's why the exercises in these emails all end in something deployed and measured: the audit gives you the task, the pipeline gives you the build, the eval gives you the number. Deployed + measured is the difference between claiming a skill and proving one."
        ) +
        p("The bootcamp compresses that into two to three weeks with instructors checking the work. Dates below.") +
        signoff(),
      ctaLabel: "See upcoming cohorts",
      ctaUrl: COHORTS,
    },
    generalStep(4, 6, 96, "The skill almost nobody on your team has (evals)"),
    {
      order: 7,
      delayHours: 120,
      subject: "Last one from me, {{first_name}}",
      body:
        h("Six lessons, one portfolio") +
        p("This is the end of the sequence. What it covered, in one place:") +
        ul([
          "Your Human Moat Score — what's automatable in your week, and what's durably yours.",
          "The seven components of a prompt that actually works.",
          "Context rot, and the four moves that fix it.",
          "The voice-to-CRM pipeline — a portfolio piece you can build in an evening.",
          "The adoption gap: 88% adopted, ~5% integrated. The gap is the career.",
          "Evals — how to attach a measured number to everything you build.",
        ]) +
        p(
          "Do those on your own and you're ahead of most of your team. Do them in the bootcamp and you'll have them deployed, measured, and reviewed by people who ship this for a living — in two to three weeks instead of six months."
        ) +
        p("If the timing is wrong, reply with the month that works and I'll flag the cohort when it opens.") +
        signoff(),
      ctaLabel: "Take a seat",
      ctaUrl: COHORTS,
    },
  ],
};

const exploreAutomateTrack: SeedCampaign = {
  slug: "explore-amp-automate-nurture-v2-value-first",
  name: "Explore & Automate Nurture v2 (value-first)",
  description:
    "Value-first variant for leads tagged goal-explore or goal-automate: each email teaches one workbook lesson aimed at automating their own work (task audit, prompting, the doorbell pattern, context, the cost ladder), cohort block closes every email. Priority 9 outranks the generic nurture (10).",
  status: "ACTIVE",
  segment: {
    sources: ["onboarding:*"],
    statuses: ["NEW", "CONTACTED"],
    anyTags: ["goal-explore", "goal-automate"],
    noneTags: ["no-drip", "goal-agency", "goal-career"],
  },
  autoEnroll: true,
  exitOnStatuses: ["QUALIFIED", "WON", "LOST"],
  priority: 9,
  timezone: brand.timezone,
  sendWindowStartHour: 8,
  sendWindowEndHour: 18,
  skipWeekends: true,
  steps: [
    generalStep(0, 1, 0, "{{first_name}}, start with the hours you lose every week"),
    generalStep(1, 2, 48),
    generalStep(3, 3, 72),
    generalStep(2, 4, 72),
    {
      order: 5,
      delayHours: 96,
      subject: "Before you buy any AI tool, read this",
      body:
        h("The cost ladder: context → retrieval → fine-tuning") +
        p(
          "When an AI workflow disappoints, there are three levers — and most people reach for the expensive one first. The right order is cost order:"
        ) +
        ul([
          "<strong>1. Curate the context (free, ten minutes).</strong> List everything the model actually sees. Cut what the task doesn't need; move the key instruction to the first or last line. Most “the model isn't smart enough” complaints dissolve right here — the model never saw the fact it needed, or saw it buried.",
          "<strong>2. Add retrieval (days).</strong> Only when the knowledge genuinely doesn't fit in the window: a system that fetches the relevant document at question time instead of pasting everything up front.",
          "<strong>3. Fine-tune (weeks).</strong> Almost never first, and only when the problem is style or format consistency — not knowledge.",
        ]) +
        p(
          "The ten-minute version you can run today: take one prompt that produces mediocre output and audit its context before touching anything else. It routinely beats an hour of rewording — and it costs nothing."
        ) +
        p("This decision ladder is a full session in the bootcamp, applied to your own workflow. Dates below.") +
        signoff(),
      ctaLabel: "See upcoming cohorts",
      ctaUrl: COHORTS,
    },
    generalStep(4, 6, 96),
    {
      order: 7,
      delayHours: 120,
      subject: "Last one from me, {{first_name}}",
      body:
        h("Six lessons, then I'll stop") +
        p("This is the end of the sequence. Everything it covered:") +
        ul([
          "The task audit — score desire × capability, automate Green Light, protect your moat.",
          "The seven components of a working prompt.",
          "The doorbell pattern — automations that start themselves.",
          "Context rot, and the four moves that fix it.",
          "The cost ladder — curate context before buying tools.",
          "Evals — ten real cases and a baseline number.",
        ]) +
        p(
          "Run those on one real task and you'll have your first automation in production within a month. Or compress the whole thing into two to three weeks with instructors in the room — that's the bootcamp, and the current dates are below."
        ) +
        p("If the timing is wrong, reply with the month that works and I'll flag the cohort when it opens.") +
        signoff(),
      ctaLabel: "Take a seat",
      ctaUrl: COHORTS,
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────
// 2. Lead-magnet downloaders. Colder intent — earn the attention first.
// ─────────────────────────────────────────────────────────────────────
const thesaurusFollowup: SeedCampaign = {
  slug: "thesaurus-followup",
  name: "Lead Magnet Follow-up (asset downloads)",
  description:
    "For leads captured by an asset/lead-magnet download. Colder than quiz traffic, so it leads with usefulness and only asks for the seat at the end.",
  status: "ACTIVE",
  segment: {
    sources: ["asset_download"],
    statuses: ["NEW", "CONTACTED"],
    noneTags: ["no-drip"],
    minAgeHours: 24, // Let the delivery email land on its own first.
  },
  autoEnroll: true,
  exitOnStatuses: ["QUALIFIED", "WON", "LOST"],
  priority: 20,
  timezone: brand.timezone,
  sendWindowStartHour: 9,
  sendWindowEndHour: 18,
  skipWeekends: true,
  steps: [
    {
      order: 1,
      delayHours: 0,
      subject: "Did you get a chance to open it?",
      body:
        h("One suggestion for how to use it") +
        p(
          "You downloaded something from us yesterday. Most downloads get saved and never opened again, so here's a way to make this one count."
        ) +
        p(
          "Don't read it front to back. Pick one process you personally do every week — a report you assemble, an inbox you triage, a follow-up you keep forgetting — and look up only the terms that touch it. Then automate that one thing."
        ) +
        p(
          "One working automation teaches you more than fifty pages of vocabulary. The vocabulary just stops you getting lost."
        ) +
        signoff(),
    },
    {
      order: 2,
      delayHours: 96,
      subject: "The three places automation actually pays off",
      body:
        h("Where to point this first") +
        p(
          "After auditing a lot of small businesses, the same three areas come up almost every time:"
        ) +
        ul([
          "<strong>Intake.</strong> Anything where a human retypes information that already exists somewhere else — forms into a CRM, emails into a spreadsheet.",
          "<strong>Follow-up.</strong> The revenue that leaks because nobody sent the second message. This is usually the fastest money.",
          "<strong>Reporting.</strong> The weekly assembly job that takes two hours and produces a document three people skim.",
        ]) +
        p(
          "None of these need an agent that thinks. They need a system that runs. That distinction is most of the job."
        ) +
        signoff(),
    },
    {
      order: 3,
      delayHours: 120,
      subject: "Why we teach this in a room instead of on video",
      body:
        h("Because the hard part isn't the instruction") +
        p(
          "Everything in our curriculum exists somewhere on YouTube, including on our own channel. So why run a bootcamp in the Mission?"
        ) +
        p(
          "Because when your automation breaks at 2pm on day four, a video can't look at your screen. Someone who has debugged that exact failure fifty times can. That's the entire difference between finishing and quietly abandoning it."
        ) +
        p(
          "We cap the in-person room at 20 seats for the same reason. Beyond that, nobody gets looked at."
        ) +
        signoff(),
      ctaLabel: "See what we run",
      ctaUrl: COHORTS,
    },
    {
      order: 4,
      delayHours: 144,
      subject: "From skill to offer",
      body:
        h("The part almost nobody teaches") +
        p(
          "There's a specific trap in learning AI automation: you get good at it, and then you have no idea what to charge, how to scope it, or how to explain it to someone who just wants their problem gone."
        ) +
        p(
          "That's why the AI Automation Agency Bootcamp spends real time on the business layer — pricing, scoping, the first engagement, the outreach. The technical half makes you capable. The business half makes you paid."
        ) +
        p("Both halves are in the same ten days."),
      ctaLabel: "See the agenda and dates",
      ctaUrl: COHORTS,
    },
    {
      order: 5,
      delayHours: 168,
      subject: "Worth a look before the next cohort fills",
      body:
        h("An honest ask") +
        p(
          "You've had a few emails from me and no pitch beyond a link. Here's the actual ask."
        ) +
        p(
          `We run the bootcamp in two formats — three weeks of evenings for people with jobs, or a ten-day intensive for people who can go all-in. In person in ${brand.address.city}, or on Zoom from anywhere. In-person is capped at 20 seats, and every date, price and format is on our cohorts page — you can book from there directly.`
        ) +
        p(
          "If it isn't a fit, no hard feelings — you can unsubscribe at the bottom and I'll leave you alone. If it might be, the dates are below."
        ) +
        signoff(),
      ctaLabel: "See dates and book a seat",
      ctaUrl: COHORTS,
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────
// 3. Qualified leads. Short, direct, includes a human-touch TASK step.
// ─────────────────────────────────────────────────────────────────────
const qualifiedClose: SeedCampaign = {
  slug: "qualified-close",
  name: "Qualified → Close",
  description:
    "Fires when staff mark a lead QUALIFIED. Short and direct, with a TASK step that puts a personal-outreach reminder in the lead's notes. Exits the moment the lead is WON or LOST.",
  status: "ACTIVE",
  segment: { statuses: ["QUALIFIED"], noneTags: ["no-drip"] },
  autoEnroll: true,
  exitOnStatuses: ["WON", "LOST"],
  priority: 5,
  timezone: brand.timezone,
  sendWindowStartHour: 9,
  sendWindowEndHour: 17,
  skipWeekends: true,
  steps: [
    {
      order: 1,
      delayHours: 2,
      subject: "{{first_name}} — want me to hold a seat?",
      body:
        h("Short one") +
        p(
          "From our conversation it sounds like the bootcamp is a real fit for what you're trying to do."
        ) +
        p(
          "In-person seats are capped at 20 per cohort, so if you tell me which date you're aiming at, I'll keep an eye on it for you. Reply with the month and the format — evenings or intensive — and I'll confirm what's still open."
        ) +
        signoff(),
      ctaLabel: "Pick your date",
      ctaUrl: COHORTS,
    },
    {
      order: 2,
      delayHours: 48,
      channel: "TASK",
      subject: "Personal follow-up — call or DM this lead before the next email",
      body: "",
    },
    {
      order: 3,
      delayHours: 48,
      subject: "Anything blocking you?",
      body:
        h("Three things usually are") +
        p("When someone stalls at this point, it's almost always one of these:") +
        ul([
          "<strong>The dates don't work.</strong> Fixable — cohorts run monthly. Tell me your month.",
          ...[
            renderScholarshipCopy(
              content.scholarshipsPerCohort,
              "<strong>The cost is the issue.</strong> Also fixable — we hold two full scholarships per cohort. " +
                `Email <a href="mailto:${CONTACT_EMAIL}" style="color:#7209B7">${CONTACT_EMAIL}</a> and ask.`,
            ),
          ].filter((item) => item.length > 0),
          "<strong>You're not sure you'll keep up.</strong> Fair. Reply and tell me your background and I'll give you a straight answer rather than a sales one.",
        ]) +
        p("Whichever it is, replying to this email is the fastest way through it.") +
        signoff(),
    },
    {
      order: 4,
      delayHours: 96,
      subject: "Closing the loop",
      body:
        h("I'll assume the timing is wrong") +
        p(
          "I haven't heard back, so I'm going to stop chasing — you have enough email."
        ) +
        p(
          "Two things before I do. Our cohorts page always has the next open dates, so nothing is lost by waiting. And if you reply with a month that works, I'll flag that cohort for you the day it opens."
        ) +
        p("Either way, good luck with the build.") +
        signoff(),
      ctaLabel: "See open cohorts",
      ctaUrl: COHORTS,
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────
// 3b. Cart recovery. Highest-intent audience in the system: they typed their
// name and email and opened Stripe Checkout. Leads arrive from
// syncAbandonedCheckouts() (./abandoned.ts) tagged `checkout-abandoned` with
// source `checkout_abandoned`; paying flips them WON, which exits them here.
//
// The `{{abandoned_item_title}}`, `{{abandoned_amount}}` and
// `{{resume_checkout_url}}` merge fields are resolved per contact from their
// latest abandoned Payment — this is the copy that can name the exact cohort
// and one-click resume the exact checkout. All three degrade to safe generic
// values, so the copy is still correct if the lookup finds nothing.
// ─────────────────────────────────────────────────────────────────────
const cartRecovery: SeedCampaign = {
  slug: "cart-recovery-abandoned-checkout",
  name: "Cart Recovery (abandoned checkout)",
  description:
    "Recovers abandoned cohort checkouts. Leads come from syncAbandonedCheckouts() in src/lib/drip/abandoned.ts, which tags expired/failed Payment rows as checkout-abandoned. Anyone who later pays is flipped to WON, which exits them here. Highest priority after qualified-close — a started checkout outranks any nurture.",
  status: "ACTIVE",
  segment: {
    sources: ["checkout_abandoned"],
    statuses: ["NEW", "CONTACTED"],
    noneTags: ["no-drip"],
  },
  autoEnroll: true,
  exitOnStatuses: ["WON", "LOST"],
  priority: 3,
  timezone: brand.timezone,
  sendWindowStartHour: 8,
  sendWindowEndHour: 18,
  // No weekend skip on purpose: checkout intent decays in hours, and a cart
  // abandoned Friday night is dead by Monday morning.
  skipWeekends: false,
  steps: [
    {
      order: 1,
      delayHours: 1,
      subject: "{{first_name}}, your seat is still there",
      body:
        h("You stopped at the last step") +
        p(
          "You started checking out for <strong>{{abandoned_item_title}}</strong> and something got in the way — a meeting, a card not to hand, second thoughts. It happens."
        ) +
        p(
          "Your place isn't booked until payment goes through, and in-person seats are capped at 20 per cohort. The link below picks up exactly where you left off."
        ) +
        signoff(),
      ctaLabel: "Finish checking out",
      ctaUrl: "{{resume_checkout_url}}",
    },
    {
      order: 2,
      delayHours: 24,
      subject: "What you actually walk out with",
      body:
        h("Not notes — deployed systems") +
        p(
          "In case the question was whether it's worth it, here is what you leave with, built by you during the sessions:"
        ) +
        ul([
          "<strong>A working AI automation</strong> running against a real business process, not a demo.",
          "<strong>Your own agent stack</strong> — Claude Code, n8n, voice agents — set up on your machine and deployed.",
          "<strong>An agency offer you can sell</strong>, priced, with the delivery process behind it.",
          `<strong>The room</strong> — founders and operators in ${brand.address.city} who keep working together after the cohort ends.`,
        ]) +
        p(
          "If the format or the dates are the blocker rather than the decision, reply and tell me which — cohorts run monthly and I can point you at the one that fits."
        ) +
        signoff(),
      ctaLabel: "Pick up where you left off",
      ctaUrl: "{{resume_checkout_url}}",
    },
    {
      order: 3,
      delayHours: 48,
      subject: "Last note about this cohort",
      body:
        h("Then I'll leave you alone") +
        p(
          "This is my last email about {{abandoned_item_title}}. If the timing is wrong, that's a real answer and there's another cohort next month."
        ) +
        renderScholarshipCopy(
          content.scholarshipsPerCohort,
          p(
            "If it's the cost: we hold two full scholarships per cohort. " +
              `Email <a href="mailto:${CONTACT_EMAIL}" style="color:#7209B7">${CONTACT_EMAIL}</a> and ask — people do, and they get them.`
          ),
        ) +
        p("Otherwise the seat is one click away, at the same price you saw.") +
        signoff(),
      ctaLabel: "Complete my registration",
      ctaUrl: "{{resume_checkout_url}}",
    },
  ],
};

// Membership (subscription) abandonment — different offer, different copy, so
// its own campaign against source `membership_abandoned`. Subscription
// sessions get no Stripe recovery URL, so this one links the membership page
// rather than a resume URL.
const membershipRecovery: SeedCampaign = {
  slug: "membership-recovery-abandoned",
  name: "Membership Recovery (abandoned subscription checkout)",
  description:
    "Recovers abandoned membership subscription checkouts, tagged membership-abandoned by syncAbandonedCheckouts(). Separate from cart recovery because the offer and the objection are different — recurring access, not a dated cohort seat.",
  status: "ACTIVE",
  segment: {
    sources: ["membership_abandoned"],
    statuses: ["NEW", "CONTACTED"],
    noneTags: ["no-drip"],
  },
  autoEnroll: true,
  exitOnStatuses: ["WON", "LOST"],
  priority: 4,
  timezone: brand.timezone,
  sendWindowStartHour: 8,
  sendWindowEndHour: 18,
  skipWeekends: false,
  steps: [
    {
      order: 1,
      delayHours: 2,
      subject: "{{first_name}}, you left mid-signup",
      body:
        h("Membership didn't go through") +
        p(
          "You started signing up for {{abandoned_item_title}} and it didn't complete, so nothing was charged and nothing is active yet."
        ) +
        p(
          "Membership is month to month — every session recording, the mentor network, and the material we build in the cohorts. Cancel any time from your account."
        ) +
        signoff(),
      ctaLabel: "Finish signing up",
      ctaUrl: COHORTS,
    },
    {
      order: 2,
      delayHours: 72,
      subject: "Worth it or not — straight answer",
      body:
        h("Who it's actually for") +
        p(
          "Membership earns its keep if you're building something now and want the recordings and the room while you do it. If you're not building yet, wait — take a cohort first and join after."
        ) +
        p(
          "That's the honest version. If you have a specific question about what's included, reply to this email and I'll answer it myself."
        ) +
        signoff(),
      ctaLabel: "See what's included",
      ctaUrl: COHORTS,
    },
  ],
};

// Program checkout recovery uses the same per-Payment resume token as cohort recovery;
// abandonedCheckoutContext() in ./engine.ts resolves `program-abandoned` contacts to the
// program's name/amount and (for failed rows) the Stripe after-expiration recovery URL.
// Seeded DRAFT like every campaign: activation is a deliberate admin-UI step at launch.
const programRecovery: SeedCampaign = {
  slug: "program-cart-recovery-abandoned-checkout",
  name: "Self-Paced Course Recovery (abandoned checkout)",
  description:
    "Recovers abandoned self-paced program checkouts tagged program-abandoned by syncAbandonedCheckouts(). {{resume_checkout_url}} resolves via abandonedCheckoutContext()'s program branch. Activate in the admin UI at launch.",
  status: "DRAFT",
  segment: {
    sources: ["program_checkout_abandoned"],
    statuses: ["NEW", "CONTACTED"],
    noneTags: ["no-drip"],
  },
  autoEnroll: true,
  exitOnStatuses: ["WON", "LOST"],
  // Priorities 3, 4 and 5 are cohort recovery, membership recovery and qualified-close.
  // Six is the adjacent free slot, still ahead of every nurture track (7–90); lowest wins.
  priority: 6,
  timezone: brand.timezone,
  sendWindowStartHour: 8,
  sendWindowEndHour: 18,
  skipWeekends: false,
  steps: [
    {
      order: 1,
      delayHours: 1,
      subject: "{{first_name}}, you stopped at checkout",
      body:
        h("Your course is waiting") +
        p(
          `You got as far as Stripe Checkout for the ${content.selfPacedProgram.name}, then stopped. Nothing was charged, and the course is not unlocked yet.`
        ) +
        p(
          "Unlike the cohorts, this one has no seat cap and no start date to race, so I won't invent urgency. The reason to finish is simpler: access opens the moment the payment clears — session one, the same night if you want it — and the link below picks up where you left off."
        ) +
        signoff(),
      ctaLabel: "Resume checkout",
      ctaUrl: "{{resume_checkout_url}}",
    },
    {
      order: 2,
      delayHours: 24,
      subject: "What the self-paced course gives you",
      body:
        h("A course built around shipping") +
        p(
          "It is the live bootcamp's curriculum, without the dates. What that actually buys you:"
        ) +
        ul([
          "<strong>Your own pace.</strong> Nothing is scheduled and nothing is gated — start tonight or start in three weeks.",
          "<strong>One payment.</strong> The course is yours and it stays yours. No subscription to keep it.",
          "<strong>The Wednesday check-in call.</strong> Live, 6pm PT, for your first 90 days. Bring what you're building or what broke.",
          "<strong>The same builds.</strong> The same real automations the cohort ships, and the agency offer you can sell at the end of them.",
        ]) +
        p(
          "If you're unsure whether it fits what you're building, reply to this email and tell me what you want to automate. I'll give you a straight answer."
        ) +
        signoff(),
      ctaLabel: "Continue to the course",
      ctaUrl: "{{resume_checkout_url}}",
    },
    {
      order: 3,
      delayHours: 72,
      subject: "Last note about the self-paced course",
      body:
        h("I'll close the loop here") +
        p(
          "This is the last email I'll send about this checkout. If now isn't the right time, I'll step back."
        ) +
        p(
          "If what's stopping you is not knowing whether it's right for you, that's what the 7-day money-back guarantee is for. Buy it, watch the sessions, come to a Wednesday call — and if it isn't what you needed, email " +
            `<a href="mailto:${CONTACT_EMAIL}" style="color:#7209B7">${CONTACT_EMAIL}</a>` +
            " within 7 days and we refund you in full."
        ) +
        p("If you do want to start, the checkout link is below.") +
        signoff(),
      ctaLabel: "Finish checking out",
      ctaUrl: "{{resume_checkout_url}}",
    },
  ],
};

// Buyers already have the course, so this sequence teaches the operating rhythm
// instead of appending a generic list of cohort dates. Seeded DRAFT like every
// launch campaign: activation is a deliberate admin-UI step at launch.
const programWelcome: SeedCampaign = {
  slug: "program-welcome-self-paced",
  name: "Self-Paced Course Welcome",
  description:
    "Welcomes self-paced program buyers, establishes the first-week course rhythm, and introduces the ongoing membership path. Activate in the admin UI at launch.",
  status: "DRAFT",
  trigger: "LEAD_SEGMENT",
  segment: {
    sources: ["program"],
    statuses: ["WON"],
    noneTags: ["no-drip"],
  },
  autoEnroll: true,
  // runDueSteps falls back to ["WON", "LOST"] when the stored list is null or
  // empty, which would drop this WON-only audience before step 1. ["LOST"] is
  // intentionally non-empty so it survives every storage path; [] would depend
  // on round-tripping as the literal string "[]" to avoid the fallback.
  exitOnStatuses: ["LOST"],
  // Eleven is the first free slot above the nurture tracks. The WON-only audience
  // is disjoint from campaigns that exit on WON, so this never actually competes.
  priority: 11,
  timezone: brand.timezone,
  sendWindowStartHour: 8,
  sendWindowEndHour: 18,
  skipWeekends: false,
  steps: [
    {
      order: 1,
      delayHours: 0,
      subject: "Welcome — here's how the self-paced bootcamp works",
      body:
        h("Start with session 1") +
        p(
          `Your ${content.selfPacedProgram.name} is ready. Start with session 1, then work through each build in order — the course page keeps your place.`
        ) +
        p(
          "The 21-chapter workbook is in <strong>Materials</strong> on the course page. For your first 90 days, bring questions and blockers to the weekly check-in call on <strong>Wednesdays at 6pm PT</strong>."
        ) +
        p(
          "You also have a 7-day full-refund guarantee. If the course is not what you need, email " +
            `<a href="mailto:${CONTACT_EMAIL}" style="color:#7209B7">${CONTACT_EMAIL}</a>` +
            " within 7 days and we'll refund it in full."
        ) +
        signoff(),
      ctaLabel: "Start session 1",
      ctaUrl: SELF_PACED_COURSE,
    },
    {
      order: 2,
      delayHours: 48,
      subject: "Your AI workstation is live",
      body:
        h("Three builds make week one count") +
        p(
          "The first-week arc is deliberate: run the <strong>HAS Audit</strong> to choose the right task, turn the result into a reusable <strong>prompt playbook</strong>, then ship your <strong>first deployed tool</strong>. Each build gives the next one real input."
        ) +
        p(
          "Your one next action: open the course, finish the HAS Audit, and choose the single task your first tool will handle. Do not pick the tool before you pick the task."
        ) +
        signoff(),
      ctaLabel: "Continue the course",
      ctaUrl: SELF_PACED_COURSE,
    },
    {
      order: 3,
      delayHours: 120,
      subject: "One week in — what is blocking the build?",
      body:
        h("Bring the stuck part, not a polished result") +
        p(
          "A week in, you should know what you are automating and where the first build is getting stuck. If you are behind, do not restart — return to the next unfinished lesson."
        ) +
        p(
          "Bring the blocker to the Wednesday 6pm PT check-in call. A broken workflow, unclear prompt, or tool choice is enough; we can work from the real constraint together."
        ) +
        signoff(),
      ctaLabel: "Open the Wednesday call",
      ctaUrl: MEMBER_CALLS,
    },
    {
      order: 4,
      delayHours: 336,
      subject: "The course stays yours — here is how to stay current",
      body:
        h("Keep the course; choose how you continue") +
        p(
          "The self-paced course is yours and stays yours. You can return to the sessions and workbook whenever a new project needs them."
        ) +
        p(
          "The curriculum keeps moving as the tools change. Membership is how you stay current: new cohort recordings, updated materials, and ongoing weekly Q&amp;A after your first 90 days. Join when that continuing layer is useful to the work you are doing."
        ) +
        signoff(),
      ctaLabel: "See membership",
      ctaUrl: MEMBERSHIP,
    },
  ],
};

// These leads asked to wait for the next bootcamp, so the sequence makes the
// three current formats explicit instead of appending the generic cohort block.
// Seeded DRAFT: activation is a deliberate admin-UI step at launch.
const nextCohortSelfPacedLaunch: SeedCampaign = {
  slug: "next-cohort-self-paced-launch",
  name: "Next-Cohort Waiters — Self-Paced Launch",
  description:
    "Tells next-cohort waiters that the recorded course is available now while keeping the live Zoom and in-person paths clear. Activate in the admin UI at launch.",
  status: "DRAFT",
  trigger: "LEAD_SEGMENT",
  segment: {
    anyTags: ["next-cohort", "seg-next-cohort"],
    statuses: ["NEW", "CONTACTED", "QUALIFIED"],
    noneTags: ["no-drip"],
  },
  autoEnroll: true,
  exitOnStatuses: ["WON", "LOST"],
  // Two is the only free slot below the nurture tracks, so this explicit request
  // for the next bootcamp is handled before every general nurture campaign.
  priority: 2,
  timezone: brand.timezone,
  sendWindowStartHour: 8,
  sendWindowEndHour: 18,
  skipWeekends: false,
  steps: [
    {
      order: 1,
      delayHours: 0,
      subject: "You asked about the next bootcamp — you can start tonight",
      body:
        h("The recorded bootcamp is ready now") +
        p(
          "You asked to hear about the next AI Automation Bootcamp. There is now a self-paced version: the same sessions, recorded and ordered so you can start immediately instead of waiting for a cohort date."
        ) +
        p(
          "You also get a weekly Wednesday 6pm PT check-in call for your first 90 days, so working at your own pace does not mean working through blockers alone."
        ) +
        signoff(),
      ctaLabel: "Start the self-paced course",
      ctaUrl: SELF_PACED,
    },
    {
      order: 2,
      delayHours: 72,
      subject: "What you build inside the self-paced bootcamp",
      body:
        h("Ten artifacts, each feeding the next") +
        p(
          "The course follows a 10-artifact portfolio arc. You start by choosing a real task, then build prompts, tools, automations, and an offer around work you can inspect and improve — not disconnected demos."
        ) +
        p(
          "The 21-chapter workbook gives each session a working document, and the Wednesday check-in calls give you a place to bring the point where your build stopped matching the plan."
        ) +
        signoff(),
      ctaLabel: "See the course",
      ctaUrl: SELF_PACED,
    },
    {
      order: 3,
      delayHours: 120,
      subject: "Three honest ways to take the bootcamp",
      body:
        h("Choose the format that fits how you work") +
        ul([
          "<strong>Self-paced tonight.</strong> Start immediately, follow the recorded sessions, and use the Wednesday check-in calls when you need a live answer.",
          `<strong>Live on Zoom.</strong> Move through the work with a scheduled cohort; see the current dates on the <a href="${COHORTS}" style="color:#7209B7;font-weight:600">cohorts page</a>.`,
          `<strong>In person in ${brand.address.city}.</strong> Build in the room with the cohort; the <a href="${COHORTS}" style="color:#7209B7;font-weight:600">cohorts page</a> shows the next in-person option.`,
        ]) +
        p(
          "If self-paced is the best fit, the 7-day full-refund guarantee gives you room to inspect the sessions and workbook. Email " +
            `<a href="mailto:${CONTACT_EMAIL}" style="color:#7209B7">${CONTACT_EMAIL}</a>` +
            " within 7 days if it is not what you need."
        ) +
        signoff(),
      ctaLabel: "Start self-paced",
      ctaUrl: SELF_PACED,
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────
// 4. Dormant leads. Low priority — only picks up leads no other track wants.
// ─────────────────────────────────────────────────────────────────────
const dormantRevive: SeedCampaign = {
  slug: "dormant-revive",
  name: "Dormant Lead Revival (30d inactive)",
  description:
    "Last attempt at leads still marked NEW with no activity for 30+ days. Three emails, low pressure, and an explicit exit so the list stays clean instead of stale.",
  status: "ACTIVE",
  segment: {
    statuses: ["NEW"],
    inactiveForDays: 30,
    noneTags: ["no-drip"],
  },
  autoEnroll: true,
  exitOnStatuses: ["QUALIFIED", "WON", "LOST"],
  priority: 90,
  timezone: brand.timezone,
  sendWindowStartHour: 9,
  sendWindowEndHour: 17,
  skipWeekends: true,
  steps: [
    {
      order: 1,
      delayHours: 0,
      subject: "Still thinking about it, or has it passed?",
      body:
        h("Genuine question") +
        p(
          `You looked at ${brand.wordmark} about a month ago and nothing came of it. That's usually one of two things: the timing was wrong, or it turned out not to be what you needed.`
        ) +
        p(
          "Both are fine. I'm asking because I'd rather send you something useful than keep guessing — reply with \"later\" or \"not for me\" and I'll act accordingly."
        ) +
        signoff(),
    },
    {
      order: 2,
      delayHours: 168,
      subject: "What's changed since you last looked",
      body:
        h("Short update") +
        p(
          "The bootcamp now runs in two formats — a three-week evening edition for people with jobs, and a ten-day intensive for people who can go all-in. Both hybrid: in person in the Mission, or Zoom from anywhere."
        ) +
        p(
          "The tooling has moved too. What we teach today isn't what we taught a year ago, because the stack genuinely changed. That's the argument for doing it now rather than next year — the gap between shipping and reading keeps widening."
        ) +
        signoff(),
      ctaLabel: "See the current lineup",
      ctaUrl: COHORTS,
    },
    {
      order: 3,
      delayHours: 240,
      subject: "Clearing you off the list",
      body:
        h("No action needed") +
        p(
          "This is my last email. I'm not going to keep mailing someone who isn't interested — that's how lists rot and how people start marking things as spam."
        ) +
        p(
          "If anything changes, our cohorts page is always current, and " +
          `<a href="mailto:${CONTACT_EMAIL}" style="color:#7209B7">${CONTACT_EMAIL}</a> reaches me directly.`
        ) +
        p("Thanks for the look. Go build something.") +
        signoff(),
    },
  ],
};


// ── Live cohort block ────────────────────────────────────────────────────
// Every step that ends in a commercial CTA gets the current cohort dates and
// prices rendered immediately above the button, so the reader never has to
// click to find out when the next one runs. {{upcoming_cohorts}} is resolved
// from the database at send time (see ./cohorts.ts) and degrades to a pointer
// at /cohorts when nothing is scheduled — it never leaves a bare token or an
// empty block in the mail.
//
// Applied programmatically rather than pasted into each body: a new step with
// a CTA picks this up automatically, which is the only way it stays true.
const SIGNOFF_MARKER = '<p style="margin:24px 0 0;color:#475569">';

const cohortBlock = () =>
  h("Next cohorts") +
  p("Current dates and pricing, straight from our calendar:") +
  "{{upcoming_cohorts}}";

/** Insert the live cohort block just above the sign-off, or at the end if the
 *  step has none. Steps without a CTA are left alone — those are the
 *  reply-driven ones, where a dates table would undercut the ask. */
function withCohortBlock(campaign: SeedCampaign): SeedCampaign {
  return {
    ...campaign,
    steps: campaign.steps.map((step) => {
      if (!step.ctaUrl || step.channel === "TASK") return step;
      if (step.body.includes("{{upcoming_cohorts}}")) return step; // already placed by hand
      const at = step.body.lastIndexOf(SIGNOFF_MARKER);
      const body =
        at === -1
          ? step.body + cohortBlock()
          : step.body.slice(0, at) + cohortBlock() + step.body.slice(at);
      return { ...step, body };
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────
// 7. Cohort pre-start reminders. COHORT_SCHEDULE: enrollment is driven by
// cohort registration (Stripe webhook / register-free / self-enroll fire
// points + the tick sweep), NOT by the segment field. Steps 2-4 anchor to the
// cohort's start instant. Ships as DRAFT — review copy, set a test email,
// then activate in /admin/contacts/campaigns.
// ─────────────────────────────────────────────────────────────────────
const cohortPreStart: SeedCampaign = {
  slug: "cohort-pre-start",
  name: "Cohort Pre-Start Reminders",
  description:
    "Welcome + T-7d + T-1d + T-2h reminder sequence for everyone registered in an upcoming cohort (paid and free). Cohort-anchored: dates, Zoom link and venue address are merged per cohort. Unsubscribed contacts are skipped; the checkout/registration confirmation emails remain the guaranteed transactional touch.",
  status: "DRAFT",
  trigger: "COHORT_SCHEDULE",
  segment: {}, // ignored for COHORT_SCHEDULE
  autoEnroll: true,
  exitOnStatuses: [], // ignored — buyers (WON) must still get reminders
  priority: 1,
  timezone: brand.timezone,
  sendWindowStartHour: 0, // ignored — reminders send whenever they're due
  sendWindowEndHour: 24,
  skipWeekends: false,
  steps: [
    {
      order: 1,
      delayHours: 0, // Welcome — next tick after registration (≤15 min).
      anchor: "ENROLLMENT",
      subject: "You're in — {{cohort_name}} starts {{cohort_start_date}}",
      body:
        h("Welcome to {{cohort_name}}") +
        p(
          "Your seat is confirmed. First session: <strong>{{cohort_start_date}}</strong> at <strong>{{cohort_start_time}}</strong>."
        ) +
        p("Between now and then, three things worth doing:") +
        ul([
          `Log into <a href="{{cohort_url}}" style="color:#7209B7;font-weight:600">your cohort page</a> and look around — materials and session schedule live there.`,
          "Bring a laptop you can install tools on. We build real systems, from day one.",
          "Think of one process in your work you'd automate if you could — we'll use it.",
        ]) +
        p("I'll send logistics (join link, address, prep) as we get close to the start.") +
        signoff(),
      ctaLabel: "Open your cohort page",
      ctaUrl: "{{cohort_url}}",
    },
    {
      order: 2,
      delayHours: 0,
      anchor: "COHORT_START",
      offsetMinutes: -7 * 24 * 60, // T-7d
      subject: "{{cohort_name}} starts in one week — how to get ready",
      body:
        h("One week out") +
        p(
          "<strong>{{cohort_name}}</strong> starts <strong>{{cohort_start_date}}</strong> at <strong>{{cohort_start_time}}</strong>."
        ) +
        p("To arrive ready instead of installing things while I talk:") +
        ul([
          "Laptop with admin rights — you'll be installing CLI tools.",
          "A Google account you're happy to use for class integrations.",
          `Skim the materials on <a href="{{cohort_url}}" style="color:#7209B7;font-weight:600">your cohort page</a>.`,
        ]) +
        p("Questions before we start? Just reply — I read these.") +
        signoff(),
      ctaLabel: "Open your cohort page",
      ctaUrl: "{{cohort_url}}",
    },
    {
      order: 3,
      delayHours: 0,
      anchor: "COHORT_START",
      offsetMinutes: -24 * 60, // T-1d
      subject: "Tomorrow: {{cohort_name}} — logistics inside",
      body:
        h("See you tomorrow") +
        p(
          "<strong>{{cohort_name}}</strong> starts tomorrow, <strong>{{cohort_start_date}}</strong>, at <strong>{{cohort_start_time}}</strong>."
        ) +
        ul([
          `<strong>Joining on Zoom:</strong> <a href="{{zoom_link}}" style="color:#7209B7;font-weight:600">your join link</a> — test your audio beforehand.`,
          "<strong>In person:</strong> {{venue_address}} — doors open 15 minutes early.",
          "Bring your laptop and charger.",
        ]) +
        p("If your plans changed, reply to this email so we can hold or release your seat.") +
        signoff(),
      ctaLabel: "Join on Zoom",
      ctaUrl: "{{zoom_link}}",
    },
    {
      order: 4,
      delayHours: 0,
      anchor: "COHORT_START",
      offsetMinutes: -120, // T-2h
      subject: "Starting soon — {{cohort_name}} at {{cohort_start_time}}",
      body:
        h("We start in about two hours") +
        p(
          "<strong>{{cohort_name}}</strong> begins at <strong>{{cohort_start_time}}</strong> today."
        ) +
        ul([
          `<strong>Zoom:</strong> <a href="{{zoom_link}}" style="color:#7209B7;font-weight:600">join here</a>.`,
          "<strong>In person:</strong> {{venue_address}}.",
        ]) +
        p("See you there.") +
        signoff(),
      ctaLabel: "Join now",
      ctaUrl: "{{zoom_link}}",
    },
  ],
};

const certificateIssued: SeedCampaign = {
  slug: "certificate-issued",
  name: "Certificate Issued",
  description: `Delivers certificate links when a learner earns an ${brand.name} certificate, with a concise follow-up by SMS.`,
  status: "DRAFT",
  trigger: CERTIFICATE_TRIGGER,
  segment: {},
  autoEnroll: false,
  exitOnStatuses: [],
  priority: 12,
  timezone: brand.timezone,
  sendWindowStartHour: 0,
  sendWindowEndHour: 24,
  skipWeekends: false,
  steps: [
    {
      order: 1,
      delayHours: 0,
      subject: "Your {{cohort_name}} certificate is ready, {{first_name}}",
      body:
        h("You earned it, {{first_name}}") +
        p(
          "Congratulations on completing <strong>{{cohort_name}}</strong>. Your certificate is ready."
        ) +
        `<p style="margin:0 0 16px"><img src="{{certificate_png_url}}" alt="{{cohort_name}} certificate preview" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0"></p>` +
        p("Certificate ID: <strong>{{certificate_id}}</strong>") +
        ul([
          `<a href="{{certificate_url}}" style="color:#7209B7;font-weight:600">Verify</a>`,
          `<a href="{{linkedin_add_url}}" style="color:#7209B7;font-weight:600">Add to LinkedIn</a>`,
        ]) +
        p("Share it with the people who backed your work.") +
        p(
          `Know a founder who should build these skills next? Send them the <a href="{{cohorts_url}}" style="color:#7209B7;font-weight:600">upcoming cohorts</a>.`
        ) +
        signoff(),
      ctaLabel: "Download PDF",
      ctaUrl: "{{certificate_pdf_url}}",
    },
    {
      order: 2,
      delayHours: 24,
      channel: "SMS",
      subject: "",
      body: `Hi {{first_name}}, your ${brand.name} certificate for {{cohort_name}} is live: {{certificate_url}}`,
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────
// Newsletter subscribers. The coldest audience we have: they asked for news,
// not for a pitch. The signup route already sends the transactional welcome,
// so this sequence starts two days later and earns the attention twice before
// it mentions anything for sale.
//
// Priority 25 — BELOW every commercial nurture on purpose. A subscriber who is
// also a live quiz lead should be in agency-launch, not here; a lead holds one
// active enrollment at a time (see engine.ts). Ongoing issues go out as
// BROADCASTs against the `newsletter` tag, never as steps appended here: an
// evergreen auto-enrolling campaign would hold that single slot forever.
// ─────────────────────────────────────────────────────────────────────
const newsletterWelcome: SeedCampaign = {
  slug: "newsletter-welcome",
  name: "Newsletter Welcome (list subscribers)",
  description:
    "For contacts who subscribed to the newsletter. They asked for updates, not an offer, so this earns attention first and only points at the hub at the end. Seeded DRAFT — activate once the copy reads right.",
  status: "DRAFT",
  segment: {
    sources: ["newsletter"],
    anyTags: ["newsletter"],
    noneTags: ["no-drip"],
    statuses: ["NEW", "CONTACTED"],
    minAgeHours: 24, // Let the transactional welcome land on its own first.
  },
  autoEnroll: true,
  exitOnStatuses: ["QUALIFIED", "WON", "LOST"],
  priority: 25,
  timezone: brand.timezone,
  sendWindowStartHour: 9,
  sendWindowEndHour: 18,
  skipWeekends: true,
  steps: [
    {
      order: 1,
      delayHours: 48,
      subject: "What we mean by 'deploy it, don't study it'",
      body:
        h("The difference that decides everything") +
        p(
          "You signed up for updates, so here's the idea the rest of them rest on."
        ) +
        p(
          "Most people learning AI right now are collecting tools. They can name a dozen and have shipped none. The people getting paid for this have usually done the opposite: one workflow they actually run, in production, that someone would notice if it stopped."
        ) +
        p(
          "That is the whole bar. Not a demo, not a prototype in a notebook — something running that a business depends on."
        ) +
        p(
          "If you want a starting point: find one process you personally repeat every week, and automate the boring middle of it. That single exercise teaches more than any course outline."
        ) +
        signoff(),
    },
    {
      order: 2,
      delayHours: 168,
      subject: "Where automation actually pays off first",
      body:
        h("Three places, almost every time") +
        p(
          "After auditing a lot of small businesses, the same three areas come up again and again:"
        ) +
        ul([
          "<strong>Intake.</strong> Anywhere a human retypes information that already exists somewhere else.",
          "<strong>Follow-up.</strong> The revenue that leaks because nobody sent the second message. Usually the fastest money.",
          "<strong>Reporting.</strong> The weekly assembly job that eats two hours and produces something three people skim.",
        ]) +
        p(
          "None of these need an agent that thinks. They need a system that runs. Most of the skill is telling those two apart."
        ) +
        p(
          `We teach this in person in ${brand.address.city}, and the current dates are always on the hub. No rush — the updates keep coming either way.`
        ) +
        signoff(),
      ctaLabel: "See what's running",
      ctaUrl: COHORTS,
    },
  ],
};

export const SEED_CAMPAIGNS: SeedCampaign[] = [
  qualifiedClose,
  agencyLaunch,
  agencyTrack,
  careerTrack,
  exploreAutomateTrack,
  thesaurusFollowup,
  dormantRevive,
]
  .map(withCohortBlock)
  // Recovery + reminder campaigns deliberately skip the cohort block. The ask
  // is to finish THIS checkout / attend THIS cohort; a table of other dates is
  // a competing choice that reopens a decision already made.
  .concat([
    cartRecovery,
    membershipRecovery,
    programRecovery,
    // Buyers already own the course; generic cohort dates would reopen the sale.
    programWelcome,
    // This sequence presents its own explicit self-paced/live/in-person choice.
    nextCohortSelfPacedLaunch,
    cohortPreStart,
    certificateIssued,
    // Newsletter subscribers asked for news, not dates — no cohort block.
    newsletterWelcome,
  ]);

export function findSeedCampaign(slug: string): SeedCampaign | undefined {
  return SEED_CAMPAIGNS.find((campaign) => campaign.slug === slug);
}
