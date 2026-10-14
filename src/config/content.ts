// Academy business content. Identity, domains, and contact details belong in
// brand.ts; catalog copy and offer details belong here.
//
// This is a neutral starter set: replace it with your academy's offers, FAQ and
// testimonials. Empty lists and empty strings hide the matching UI.
//
// Keep this module client-safe: no imports, node APIs, or environment reads.

export interface ContentTestimonial {
  youtubeId: string;
  quote?: string;
  name?: string;
  role: string;
  featured?: boolean;
}

export type ContentMembershipTierId = "MENTOR_NETWORK" | "ACCELERATOR";

export interface ContentMembershipTier {
  id: ContentMembershipTierId;
  label: string;
  cardTitle: string;
  description: string;
  amountCents: number;
  tagline: string;
  bestFor: string;
  features: readonly string[];
}

export interface ContentMembershipPerk {
  image: string;
  alt: string;
  eyebrow: string;
  title: string;
  body: string;
  tierId: ContentMembershipTierId;
}

export interface ContentMembershipFaq {
  question: string;
  answer: string;
}

export interface ContentSelfPacedTextSegment {
  text: string;
  strong?: boolean;
}

export interface ContentSelfPacedRichParagraph {
  segments: readonly ContentSelfPacedTextSegment[];
}

export interface ContentSelfPacedCard {
  title: string;
  body: string;
}

export interface ContentSelfPacedStory {
  text: string;
}

export interface ContentSelfPacedQuoteTestimonial {
  quote: string;
  attribution: string;
}

export interface ContentSelfPacedStat {
  value: string;
  label: string;
}

export interface ContentSelfPacedFaq {
  question: string;
  answer: string;
  answerWithoutHours?: string;
}

export interface ContentSelfPacedPortfolioStep {
  number: string;
  asset: string;
  meaning: string;
  checkpoint: boolean;
}

export interface ContentSelfPacedMilestone {
  title: string;
  body: string;
}

export interface ContentSelfPacedComparisonOption {
  title: string;
  priceLabel: string;
  body: string;
}

export interface SelfPacedPageContent {
  metadata: {
    title: string;
    description: string;
  };
  success: {
    badge: string;
    title: string;
    body: string;
    guestBody: string;
    courseCta: string;
    checkInTitle: string;
    checkInBody: string;
    guaranteeTitle: string;
    guaranteeBody: string;
    membershipBody: string;
  };
  cancelledMessage: string;
  hero: {
    badge: string;
    title: string;
    titleAccent: string;
    description: string;
    priceSuffix: string;
    priceFallback: string;
    primaryCta: string;
    secondaryCta: string;
    imageAlt: string;
  };
  problem: {
    eyebrow: string;
    title: string;
    paragraphs: readonly ContentSelfPacedRichParagraph[];
  };
  paths: {
    eyebrow: string;
    title: string;
    intro: string;
    cards: readonly {
      title: string;
      body: readonly ContentSelfPacedTextSegment[];
    }[];
  };
  included: {
    eyebrow: string;
    titleWithSessions: string;
    titleWithoutSessions: string;
    descriptionWithHours: string;
    descriptionWithoutHours: string;
    cards: readonly ContentSelfPacedCard[];
    materialsHeading: string;
  };
  portfolio: {
    eyebrow: string;
    title: string;
    intro: string;
    steps: readonly ContentSelfPacedPortfolioStep[];
    milestonesHeading: string;
    milestones: readonly ContentSelfPacedMilestone[];
  };
  rationale: {
    eyebrow: string;
    title: string;
    paragraphs: readonly string[];
  };
  comparison: {
    eyebrow: string;
    title: string;
    currentBadge: string;
    selfPacedTitle: string;
    oneTimeLabel: string;
    selfPacedBody: string;
    priceFallback: string;
    options: readonly ContentSelfPacedComparisonOption[];
    outro: string;
    datesPrefix: string;
  };
  storiesHeading: string;
  stories: readonly ContentSelfPacedStory[];
  testimonial: ContentSelfPacedQuoteTestimonial | null;
  storiesOutro: string;
  stats: readonly ContentSelfPacedStat[];
  guarantee: {
    eyebrow: string;
    title: string;
    body: string;
  };
  faqHeading: {
    eyebrow: string;
    title: string;
  };
  faq: readonly ContentSelfPacedFaq[];
  membership: {
    eyebrow: string;
    title: string;
    body: string;
  };
  closing: {
    title: string;
    bodyWithPrice: string;
    bodyWithoutPrice: string;
    cta: string;
    contactCta: string;
  };
}

export interface Content {
  testimonials: readonly ContentTestimonial[];
  membershipTiers: readonly ContentMembershipTier[];
  selfPacedProgram: {
    name: string;
    priceCents: number;
  };
  selfPacedPage: SelfPacedPageContent;
  membershipPage: {
    perks: readonly ContentMembershipPerk[];
    faq: readonly ContentMembershipFaq[];
  };
  cohortsPage: {
    /** Empty hides the tagline. */
    tagline: string;
    /** Empty hides the community-events link. */
    communityEventsLabel: string;
    /** Empty hides the scholarship note. */
    scholarshipNote: string;
  };
  locations: {
    description: string;
  };
  certificate: {
    /** Empty hides the program-description line. */
    programDescription: string;
    /** Empty hides the demonstrated-competencies block. */
    competencies: readonly string[];
    /** Empty hides the location line. */
    location: string;
  };
  /** Zero disables scholarship copy in seeded campaigns. */
  scholarshipsPerCohort?: number;
}

export const content: Content = {
  // Student testimonials (YouTube video id + optional quote). Empty hides the testimonials wall.
  testimonials: [],

  // Prices are display copy; checkout uses the Stripe price ids configured in Admin → Integrations.
  membershipTiers: [
    {
      id: "MENTOR_NETWORK",
      label: "Recordings",
      cardTitle: "Access To All Recordings",
      description:
        "Every new cohort's recordings and refreshed materials, plus ongoing Q&A calls and the online community.",
      amountCents: 2900,
      tagline: "Where graduates stay current.",
      bestFor: "Graduates who want to keep up as the curriculum and tools evolve.",
      features: [
        "New cohort session recordings as they are added",
        "Updated materials as they ship",
        "Ongoing Q&A calls",
        "The online community",
      ],
    },
    {
      id: "ACCELERATOR",
      label: "Accelerator",
      cardTitle: "Accelerator",
      description:
        "All classes, access to the space, and 1:1 mentorship for graduates building a business.",
      amountCents: 19900,
      tagline: "For graduates building a real business.",
      bestFor: "Graduates launching a product or agency who want advisors, a workspace and momentum.",
      features: [
        "1:1 mentorship",
        "All in-person and online classes as refreshers",
        "Access to the space outside class hours",
      ],
    },
  ],

  selfPacedProgram: {
    name: "Self-Paced Course",
    priceCents: 9900,
  },

  selfPacedPage: {
    metadata: {
      title: "Self-Paced Course",
      description: "Learn practical skills at your own pace.",
    },
    success: {
      badge: "Payment confirmed",
      title: "You’re in.",
      body: "Your course access is ready.",
      guestBody: "Check your email to finish setting up your account.",
      courseCta: "Go to the course →",
      checkInTitle: "Start when you are ready.",
      checkInBody: "Your course page has everything you need.",
      guaranteeTitle: "Review your purchase.",
      guaranteeBody: "Contact {{CONTACT_EMAIL}} if you need help.",
      membershipBody: "Explore other learning options when you finish.",
    },
    cancelledMessage: "Checkout cancelled — nothing was charged.",
    hero: {
      badge: "Self-paced learning",
      title: "Learn at your own pace.",
      titleAccent: "Build practical skills.",
      description: "Work through the course whenever it fits your schedule.",
      priceSuffix: "one-time purchase",
      priceFallback: "Pricing announced shortly",
      primaryCta: "Get instant access",
      secondaryCta: "See what’s inside",
      imageAlt: "Learners at a {{BRAND_NAME}} session",
    },
    problem: {
      eyebrow: "Practical learning",
      title: "Build skills by doing the work",
      paragraphs: [
        { segments: [{ text: "Follow the lessons, complete the exercises, and apply each idea to a real project." }] },
      ],
    },
    paths: {
      eyebrow: "Put it to work",
      title: "Learn and apply",
      intro: "Use the material on projects that matter to you.",
      cards: [
        { title: "Learn", body: [{ text: "Build a clear foundation." }] },
        { title: "Apply", body: [{ text: "Turn each lesson into working practice." }] },
      ],
    },
    included: {
      eyebrow: "What you get",
      titleWithSessions: "{{SESSION_COUNT}} recorded sessions and course materials",
      titleWithoutSessions: "Recorded lessons and course materials",
      descriptionWithHours: "Work through {{TOTAL_HOURS}} hours of lessons on your schedule.",
      descriptionWithoutHours: "Work through the lessons on your schedule.",
      cards: [
        { title: "Recorded lessons", body: "Watch each lesson when it suits you." },
        { title: "Course materials", body: "Use the included references as you build." },
      ],
      materialsHeading: "Included materials",
    },
    portfolio: {
      eyebrow: "Course path",
      title: "Build as you learn",
      intro: "Each step gives you something practical to use.",
      steps: [],
      milestonesHeading: "",
      milestones: [],
    },
    rationale: {
      eyebrow: "Flexible by design",
      title: "A course that fits your schedule",
      paragraphs: ["Pause, revisit, and continue when you are ready."],
    },
    comparison: {
      eyebrow: "",
      title: "",
      currentBadge: "",
      selfPacedTitle: "",
      oneTimeLabel: "",
      selfPacedBody: "",
      priceFallback: "",
      options: [],
      outro: "",
      datesPrefix: "",
    },
    storiesHeading: "",
    stories: [],
    testimonial: null,
    storiesOutro: "",
    stats: [],
    guarantee: {
      eyebrow: "",
      title: "",
      body: "",
    },
    faqHeading: {
      eyebrow: "",
      title: "",
    },
    faq: [],
    membership: {
      eyebrow: "",
      title: "",
      body: "",
    },
    closing: {
      title: "Learn at your own pace",
      bodyWithPrice: "{{PRICE}}, one time. Start when you are ready.",
      bodyWithoutPrice: "Start when you are ready.",
      cta: "Get instant access",
      contactCta: "Ask a question",
    },
  },

  membershipPage: {
    // Image cards with copy, each tied to a tier. Empty hides the perks section.
    perks: [],
    faq: [
      {
        question: "Can I cancel anytime?",
        answer: "Yes. It's a monthly subscription — cancel whenever, and you keep access through the end of the period you've already paid for.",
      },
      {
        question: "Do I need an account before I subscribe?",
        answer: "No. Start checkout as a guest and Stripe collects your email; your access is set up from the payment. If you already have an account, sign in first so the membership attaches to it.",
      },
      {
        question: "Can I upgrade later?",
        answer: "Yes. Email {{CONTACT_EMAIL}} and we'll move you across.",
      },
    ],
  },

  cohortsPage: {
    tagline: "Live, hands-on cohorts — in person and online.",
    communityEventsLabel: "",
    scholarshipNote: "",
  },

  locations: {
    description: "Our home base for in-person classes, meetups, and deep-work days.",
  },

  certificate: {
    programDescription: "A practical program in applied technology and automation.",
    competencies: [],
    location: "",
  },

  scholarshipsPerCohort: 0,
};
