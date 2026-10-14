// scripts/seed-drip-campaigns.ts
// Install (or refresh) the seeded drip campaigns from src/lib/drip/campaigns.ts.
//
//   npm run seed:drip           # create missing campaigns, never touch existing ones
//   npm run seed:drip -- --force  # ALSO overwrite settings + replace all steps
//
// Default behaviour is create-only on purpose: once a campaign is live, its copy
// belongs to whoever edited it in the admin UI, not to this file. --force discards
// those edits (enrollments and send history survive — steps are replaced by id, so
// re-running --force resets sequence position bookkeeping only where steps vanish).

import prisma from "../src/lib/prisma";
import { SEED_CAMPAIGNS } from "../src/lib/drip/campaigns";
import { serializeSegment } from "../src/lib/drip/segment";

const force = process.argv.includes("--force");

async function main() {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const seed of SEED_CAMPAIGNS) {
    const existing = await prisma.dripCampaign.findUnique({
      where: { slug: seed.slug },
      select: { id: true },
    });

    const settings = {
      name: seed.name,
      description: seed.description,
      status: seed.status,
      trigger: seed.trigger ?? "LEAD_SEGMENT",
      segment: serializeSegment(seed.segment),
      autoEnroll: seed.autoEnroll,
      exitOnStatuses: JSON.stringify(seed.exitOnStatuses),
      priority: seed.priority,
      timezone: seed.timezone,
      sendWindowStartHour: seed.sendWindowStartHour,
      sendWindowEndHour: seed.sendWindowEndHour,
      skipWeekends: seed.skipWeekends,
    };

    const steps = seed.steps.map((step) => ({
      order: step.order,
      delayHours: step.delayHours,
      anchor: step.anchor ?? "ENROLLMENT",
      offsetMinutes: step.offsetMinutes ?? 0,
      channel: step.channel ?? "EMAIL",
      subject: step.subject,
      body: step.body,
      ctaLabel: step.ctaLabel ?? null,
      ctaUrl: step.ctaUrl ?? null,
    }));

    if (!existing) {
      await prisma.dripCampaign.create({
        data: { slug: seed.slug, ...settings, steps: { create: steps } },
      });
      created += 1;
      console.log(`+ created ${seed.slug} (${steps.length} steps, ${seed.status})`);
      continue;
    }

    if (!force) {
      skipped += 1;
      console.log(`= skipped ${seed.slug} (exists; pass --force to overwrite)`);
      continue;
    }

    await prisma.$transaction([
      prisma.dripStep.deleteMany({ where: { campaignId: existing.id } }),
      prisma.dripCampaign.update({
        where: { id: existing.id },
        data: { ...settings, steps: { create: steps } },
      }),
    ]);
    updated += 1;
    console.log(`~ overwrote ${seed.slug} (${steps.length} steps)`);
  }

  console.log(`\nDone. created=${created} overwritten=${updated} skipped=${skipped}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
