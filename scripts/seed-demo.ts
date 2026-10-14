// Seed a complete, brand-neutral demo for the open-source quickstart.
//
//   npm run seed:demo             # SQLite development/test databases only
//   npm run seed:demo -- --force  # bypass the production/database URL guard
//
// Every record uses a stable email, name, slug, or compound key, so rerunning
// the script refreshes the demo in place without removing existing data.

import bcrypt from "bcryptjs";

import prisma from "../src/lib/prisma";
import { serializeRoles, type RoleValue } from "../src/lib/roles";
import {
  assertSeedAllowed,
  demoCohortWindow,
  demoSessionDates,
  parseSeedArgs,
} from "../src/lib/seedDemoGuard";
import { demoOnboardingQuiz } from "../src/lib/demoOnboardingQuiz";

interface DemoProfile {
  profileVisibility: "PUBLIC";
  slug: string;
  headline: string;
  bio: string;
  expertiseTags: string;
  location: string;
}

interface DemoUserSeed {
  email: string;
  password: string;
  name: string;
  role: RoleValue;
  profile?: DemoProfile;
}

interface DemoLessonSeed {
  name: string;
  intro: string;
  text: string;
  duration: number;
}

interface DemoModuleSeed {
  name: string;
  description: string;
  lessons: DemoLessonSeed[];
}

const DEMO_EMAIL_VERIFIED_AT = new Date("2024-01-01T00:00:00.000Z");
const PROGRAM_NAME = "Intro to AI Automation";
const COHORT_SLUG = "intro-to-ai-automation-demo";

const DEMO_USERS: DemoUserSeed[] = [
  {
    email: "admin@example.com",
    password: "admin1234", // gitleaks:allow (public demo login)
    name: "Demo Admin",
    role: "ADMIN",
  },
  {
    email: "instructor@example.com",
    password: "instructor1234", // gitleaks:allow (public demo login)
    name: "Demo Instructor",
    role: "INSTRUCTOR",
    profile: {
      profileVisibility: "PUBLIC",
      slug: "demo-instructor",
      headline: "AI automation instructor",
      bio: "<p>Helps teams turn repetitive work into reliable, human-centered automations.</p>",
      expertiseTags: "AI automation,Workflow design,No-code tools",
      location: "Online",
    },
  },
  {
    email: "student@example.com",
    password: "student1234", // gitleaks:allow (public demo login)
    name: "Demo Student",
    role: "STUDENT",
  },
];

const DEMO_MODULES: DemoModuleSeed[] = [
  {
    name: "Automation Foundations",
    description: "Understand where AI automation creates useful, measurable leverage.",
    lessons: [
      {
        name: "What Makes a Good Automation?",
        intro: "Learn to spot work that is repeatable, bounded, and worth automating.",
        text: "<p>Start with a frequent task, a clear trigger, and an outcome a person can verify.</p>",
        duration: 480,
      },
      {
        name: "Map the Human Workflow",
        intro: "Document the current process before choosing tools.",
        text: "<p>Write down the inputs, decisions, handoffs, and exceptions in the existing workflow.</p>",
        duration: 600,
      },
      {
        name: "Choose a Safe First Project",
        intro: "Scope an automation that is useful and easy to supervise.",
        text: "<p>Prefer reversible actions and keep a human approval step around consequential decisions.</p>",
        duration: 420,
      },
    ],
  },
  {
    name: "Build and Improve",
    description: "Create a small workflow, test it, and improve it using real feedback.",
    lessons: [
      {
        name: "Build the First Version",
        intro: "Connect a trigger, an AI step, and a useful destination.",
        text: "<p>Use representative sample data and keep each step observable while you build.</p>",
        duration: 720,
      },
      {
        name: "Test, Measure, and Iterate",
        intro: "Turn failures and edge cases into a practical improvement loop.",
        text: "<p>Review outputs, record failure modes, and change one part of the workflow at a time.</p>",
        duration: 540,
      },
    ],
  },
];

const parsedArgs = parseSeedArgs(process.argv.slice(2));
try {
  assertSeedAllowed({
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env.DATABASE_URL,
    force: parsedArgs.force,
  });
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : "Demo seed refused for an unknown reason.");
  process.exit(1);
}

async function upsertDemoUser(seed: DemoUserSeed): Promise<{ id: string }> {
  const existing = await prisma.user.findUnique({
    where: { email: seed.email },
    select: { password: true },
  });
  const existingPassword = existing?.password;
  const passwordMatches = existingPassword
    ? await bcrypt.compare(seed.password, existingPassword)
    : false;
  const password = passwordMatches
    ? existingPassword
    : await bcrypt.hash(seed.password, 10);
  const roles = serializeRoles([seed.role]);

  return prisma.user.upsert({
    where: { email: seed.email },
    create: {
      email: seed.email,
      name: seed.name,
      password,
      role: seed.role,
      roles,
      emailVerified: DEMO_EMAIL_VERIFIED_AT,
      ...seed.profile,
    },
    update: {
      name: seed.name,
      password,
      role: seed.role,
      roles,
      ...seed.profile,
    },
    select: { id: true },
  });
}

async function upsertDemoOnboardingQuiz(input: {
  programId: string;
  cohortSlug: string;
}): Promise<number> {
  const quiz = demoOnboardingQuiz({
    coursePath: `/courses/${input.programId}`,
    cohortPath: `/cohorts/${input.cohortSlug}`,
  });
  const form = await prisma.onboardingForm.upsert({
    where: { slug: quiz.slug },
    create: {
      slug: quiz.slug,
      title: quiz.title,
      description: quiz.description,
      defaultRedirectUrl: quiz.defaultRedirectUrl,
      aiPrompt: null,
      ghlFieldMapping: null,
    },
    update: {
      title: quiz.title,
      description: quiz.description,
      defaultRedirectUrl: quiz.defaultRedirectUrl,
      routingElementId: null,
      aiPrompt: null,
      ghlFieldMapping: null,
    },
  });

  for (const stepSeed of quiz.steps) {
    const step = await prisma.onboardingStep.upsert({
      where: { formId_slug: { formId: form.id, slug: stepSeed.slug } },
      create: {
        id: stepSeed.id,
        formId: form.id,
        slug: stepSeed.slug,
        title: stepSeed.title,
        order: stepSeed.order,
      },
      update: {
        title: stepSeed.title,
        order: stepSeed.order,
      },
    });

    for (const elementSeed of stepSeed.elements) {
      await prisma.onboardingElement.upsert({
        where: { id: elementSeed.id },
        create: {
          id: elementSeed.id,
          stepId: step.id,
          type: elementSeed.type,
          label: elementSeed.label,
          required: elementSeed.required,
          order: elementSeed.order,
        },
        update: {
          stepId: step.id,
          type: elementSeed.type,
          label: elementSeed.label,
          required: elementSeed.required,
          order: elementSeed.order,
        },
      });

      for (const optionSeed of elementSeed.options) {
        await prisma.onboardingOption.upsert({
          where: { id: optionSeed.id },
          create: {
            id: optionSeed.id,
            elementId: elementSeed.id,
            text: optionSeed.text,
            tag: optionSeed.tag,
            order: optionSeed.order,
            nextStepId: null,
            redirectUrl: optionSeed.redirectUrl,
          },
          update: {
            elementId: elementSeed.id,
            text: optionSeed.text,
            tag: optionSeed.tag,
            order: optionSeed.order,
            nextStepId: null,
            redirectUrl: optionSeed.redirectUrl,
          },
        });
      }
    }
  }

  await prisma.onboardingForm.update({
    where: { id: form.id },
    data: { routingElementId: quiz.routingElementId },
  });

  return quiz.steps.reduce((count, step) => count + step.elements.length, 0);
}

async function main(): Promise<void> {
  const users = new Map<string, { id: string }>();
  for (const seed of DEMO_USERS) {
    users.set(seed.email, await upsertDemoUser(seed));
  }

  const instructor = users.get("instructor@example.com");
  const student = users.get("student@example.com");
  if (!instructor || !student) {
    throw new Error("Demo seed could not resolve the required instructor and student records.");
  }

  const programSettings = {
    description: "A practical introduction to finding, building, and improving useful AI automations.",
    status: "open",
    accessMode: "cohort",
    priceCents: null,
  };
  const existingProgram = await prisma.program.findFirst({ where: { name: PROGRAM_NAME } });
  const program = existingProgram
    ? await prisma.program.update({
        where: { id: existingProgram.id },
        data: programSettings,
      })
    : await prisma.program.create({
        data: { name: PROGRAM_NAME, ...programSettings },
      });

  let lessonCount = 0;
  for (const [moduleOrder, moduleSeed] of DEMO_MODULES.entries()) {
    const moduleRecord = await prisma.module.upsert({
      where: { programId_name: { programId: program.id, name: moduleSeed.name } },
      create: {
        programId: program.id,
        name: moduleSeed.name,
        description: moduleSeed.description,
        order: moduleOrder,
      },
      update: {
        description: moduleSeed.description,
        order: moduleOrder,
      },
    });

    for (const [lessonOrder, lessonSeed] of moduleSeed.lessons.entries()) {
      await prisma.lesson.upsert({
        where: { moduleId_name: { moduleId: moduleRecord.id, name: lessonSeed.name } },
        create: {
          moduleId: moduleRecord.id,
          name: lessonSeed.name,
          type: "text",
          text: lessonSeed.text,
          intro: lessonSeed.intro,
          duration: lessonSeed.duration,
          order: lessonOrder,
        },
        update: {
          type: "text",
          text: lessonSeed.text,
          intro: lessonSeed.intro,
          duration: lessonSeed.duration,
          order: lessonOrder,
        },
      });
      lessonCount += 1;
    }
  }

  const now = new Date();
  const cohortWindow = demoCohortWindow(now);
  const cohortSettings = {
    title: "Intro to AI Automation — Demo Cohort",
    description: "<p>A welcoming, hands-on cohort for building your first useful AI automation.</p>",
    status: "ENROLLMENT",
    deliveryMode: "ONLINE",
    startDate: cohortWindow.startDate,
    endDate: cohortWindow.endDate,
    startTime: "6:00 PM",
    endTime: "8:00 PM",
    timezone: "PT",
    tools: "ChatGPT, Zapier, Make",
    leadMagnet: false,
    programs: { connect: { id: program.id } },
    instructors: { connect: { id: instructor.id } },
  };
  const cohort = await prisma.cohort.upsert({
    where: { slug: COHORT_SLUG },
    create: { slug: COHORT_SLUG, ...cohortSettings },
    update: cohortSettings,
  });

  const existingGroup = await prisma.group.findFirst({
    where: { cohortId: cohort.id, name: "Online" },
  });
  const groupSettings = { inPerson: false, price: 0, seats: 30 };
  const group = existingGroup
    ? await prisma.group.update({
        where: { id: existingGroup.id },
        data: groupSettings,
      })
    : await prisma.group.create({
        data: { cohortId: cohort.id, name: "Online", ...groupSettings },
      });

  await prisma.cohortInstructor.upsert({
    where: {
      cohortId_instructorId: { cohortId: cohort.id, instructorId: instructor.id },
    },
    create: { cohortId: cohort.id, instructorId: instructor.id, status: "CONFIRMED" },
    update: { status: "CONFIRMED" },
  });

  const sessionDates = demoSessionDates(now);
  const sessionTitles = [
    "Session 1: Automation Foundations",
    "Session 2: Workflow Design",
    "Session 3: Build and Iterate",
  ];
  for (const [order, title] of sessionTitles.entries()) {
    const sessionSettings = {
      date: sessionDates[order]!,
      startTime: "6:00 PM",
      endTime: "8:00 PM",
      timezone: "PST",
      status: "upcoming",
      order,
      instructorId: instructor.id,
    };
    const existingSession = await prisma.cohortSession.findFirst({
      where: { cohortId: cohort.id, title },
    });
    if (existingSession) {
      await prisma.cohortSession.update({
        where: { id: existingSession.id },
        data: sessionSettings,
      });
    } else {
      await prisma.cohortSession.create({
        data: { cohortId: cohort.id, title, ...sessionSettings },
      });
    }
  }

  await prisma.enrollment.upsert({
    where: { userId_cohortId: { userId: student.id, cohortId: cohort.id } },
    create: { userId: student.id, cohortId: cohort.id, source: "manual", status: "active" },
    update: { source: "manual", status: "active" },
  });
  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId: group.id, userId: student.id } },
    create: { groupId: group.id, userId: student.id },
    update: {},
  });

  const onboardingQuestionCount = await upsertDemoOnboardingQuiz({
    programId: program.id,
    cohortSlug: cohort.slug ?? COHORT_SLUG,
  });

  console.log(
    `Demo seed complete. touched: users=${DEMO_USERS.length}, programs=1, modules=${DEMO_MODULES.length}, lessons=${lessonCount}, cohorts=1, groups=1, instructors=1, sessions=${sessionTitles.length}, enrollments=1, groupMembers=1, onboardingForms=1, onboardingQuestions=${onboardingQuestionCount}`,
  );
  console.table(DEMO_USERS.map(({ email, password, role }) => ({ email, password, role })));
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  console.log(`Login: ${appUrl.replace(/\/$/, "")}/login`);
}

main()
  .catch((error: unknown) => {
    console.error("Demo seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
