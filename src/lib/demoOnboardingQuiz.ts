import type { OnboardingElementType } from "@/lib/onboarding-security";

export interface DemoOnboardingOptionSeed {
  id: string;
  text: string;
  tag: string;
  order: number;
  redirectUrl: string | null;
}

export interface DemoOnboardingElementSeed {
  id: string;
  type: OnboardingElementType;
  label: string;
  required: boolean;
  order: number;
  options: DemoOnboardingOptionSeed[];
}

export interface DemoOnboardingStepSeed {
  id: string;
  slug: string;
  title: string;
  order: number;
  elements: DemoOnboardingElementSeed[];
}

export interface DemoOnboardingQuizSeed {
  slug: "ai-path";
  title: string;
  description: string;
  defaultRedirectUrl: string;
  routingElementId: string;
  steps: DemoOnboardingStepSeed[];
}

export interface DemoOnboardingQuizDestinations {
  coursePath?: string;
  cohortPath?: string;
}

export function demoOnboardingQuiz(
  destinations: DemoOnboardingQuizDestinations = {},
): DemoOnboardingQuizSeed {
  const coursePath = destinations.coursePath ?? "/courses";
  const cohortPath = destinations.cohortPath ?? "/cohorts";

  return {
    slug: "ai-path",
    title: "Find Your AI Learning Path",
    description: "Answer four quick questions to choose a practical next step.",
    defaultRedirectUrl: "/courses",
    routingElementId: "demo-ai-path-element-format",
    steps: [
      {
        id: "demo-ai-path-step-goal",
        slug: "goal",
        title: "Your goal",
        order: 0,
        elements: [
          {
            id: "demo-ai-path-element-goal",
            type: "single_choice",
            label: "What would you most like AI to help you do?",
            required: true,
            order: 0,
            options: [
              {
                id: "demo-ai-path-option-goal-save-time",
                text: "Save time on repetitive work",
                tag: "goal-efficiency",
                order: 0,
                redirectUrl: null,
              },
              {
                id: "demo-ai-path-option-goal-build",
                text: "Build a useful AI workflow",
                tag: "goal-build",
                order: 1,
                redirectUrl: null,
              },
              {
                id: "demo-ai-path-option-goal-career",
                text: "Develop skills for my career",
                tag: "goal-career",
                order: 2,
                redirectUrl: null,
              },
            ],
          },
        ],
      },
      {
        id: "demo-ai-path-step-experience",
        slug: "experience",
        title: "Your experience",
        order: 1,
        elements: [
          {
            id: "demo-ai-path-element-experience",
            type: "single_choice",
            label: "How much hands-on experience do you have with AI tools?",
            required: true,
            order: 0,
            options: [
              {
                id: "demo-ai-path-option-experience-new",
                text: "I am just getting started",
                tag: "experience-new",
                order: 0,
                redirectUrl: null,
              },
              {
                id: "demo-ai-path-option-experience-some",
                text: "I have tried a few tools",
                tag: "experience-some",
                order: 1,
                redirectUrl: null,
              },
              {
                id: "demo-ai-path-option-experience-builder",
                text: "I already build workflows",
                tag: "experience-builder",
                order: 2,
                redirectUrl: null,
              },
            ],
          },
        ],
      },
      {
        id: "demo-ai-path-step-workflow",
        slug: "workflow",
        title: "A workflow to improve",
        order: 2,
        elements: [
          {
            id: "demo-ai-path-element-workflow",
            type: "text_multi",
            label: "What workflow would you most like to improve?",
            required: false,
            order: 0,
            options: [],
          },
        ],
      },
      {
        id: "demo-ai-path-step-format",
        slug: "format",
        title: "Choose your next step",
        order: 3,
        elements: [
          {
            id: "demo-ai-path-element-format",
            type: "single_choice",
            label: "How would you like to continue learning?",
            required: true,
            order: 0,
            options: [
              {
                id: "demo-ai-path-option-format-course",
                text: "Start with a self-paced course",
                tag: "format-self-paced",
                order: 0,
                redirectUrl: coursePath,
              },
              {
                id: "demo-ai-path-option-format-cohort",
                text: "Learn with a live cohort",
                tag: "format-live",
                order: 1,
                redirectUrl: cohortPath,
              },
            ],
          },
        ],
      },
    ],
  };
}
