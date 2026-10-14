import type { Metadata } from "next";
import Link from "next/link";
import { MobileMenuButton } from '@/components/MobileMenuButton';
import { brand, brandCityAddress } from "@/config/brand";

export const metadata: Metadata = {
  title: `Terms of Service — ${brand.name}`,
  description:
    `${brand.name} Terms of Service. Read the terms and conditions that govern your use of our platform.`,
};

export default function TermsOfServicePage() {
  const lastUpdated = "March 11, 2026";
  const contactEmail = brand.email.legal;
  const siteUrl = brand.urls.hub;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between">
          <Link
            href="/"
            className="text-base md:text-lg font-bold text-slate-900 dark:text-white hover:text-primary focus-visible:ring-2 focus-visible:ring-primary rounded transition-colors min-h-[44px] flex items-center"
          >
            ← {brand.name}
          </Link>
          <nav className="flex gap-3 md:gap-6 text-sm">
            <Link
              href="/terms"
              className="text-primary font-semibold focus-visible:ring-2 focus-visible:ring-primary rounded transition-colors min-h-[44px] flex items-center"
            >
              <span className="hidden sm:inline">Terms of Service</span>
              <span className="sm:hidden">Terms</span>
            </Link>
            <Link
              href="/privacy"
              className="text-slate-500 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary rounded transition-colors min-h-[44px] flex items-center"
            >
              <span className="hidden sm:inline">Privacy Policy</span>
              <span className="sm:hidden">Privacy</span>
            </Link>
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-16">
        <div className="mb-12">
          <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight mb-4">
            Terms of Service
          </h1>
          <p className="text-slate-500 dark:text-slate-400">
            Last updated: {lastUpdated}
          </p>
        </div>

        <div className="prose prose-slate dark:prose-invert max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-a:text-primary prose-a:no-underline hover:prose-a:underline">
          <section className="mb-12">
            <h2>1. Acceptance of Terms</h2>
            <p>
              By accessing or using the {brand.name} platform located at{" "}
              <a href={siteUrl}>{siteUrl}</a> (the &quot;Service&quot;), operated
              by {brand.legalName} (&quot;{brand.name},&quot; &quot;we,&quot;
              &quot;us,&quot; or &quot;our&quot;), located at {brandCityAddress}, you agree to be bound by these
              Terms of Service (&quot;Terms&quot;). If you do not agree to these
              Terms, you may not use the Service.
            </p>
            <p>
              We reserve the right to update or modify these Terms at any time.
              We will notify you of material changes by updating the &quot;Last
              updated&quot; date. Your continued use of the Service constitutes
              acceptance of the updated Terms.
            </p>
          </section>

          <section className="mb-12">
            <h2>2. Eligibility</h2>
            <p>
              You must be at least 13 years of age to use the Service. If you
              are between 13 and 18 years of age, you may only use the Service
              with the consent and supervision of a parent or legal guardian. By
              using the Service, you represent and warrant that you meet these
              eligibility requirements.
            </p>
          </section>

          <section className="mb-12">
            <h2>3. Account Registration</h2>
            <ul>
              <li>
                You may register for an account using your email and password or
                through a third-party authentication provider (e.g., Google).
              </li>
              <li>
                You are responsible for maintaining the confidentiality of your
                account credentials and for all activities that occur under your
                account.
              </li>
              <li>
                You agree to provide accurate, current, and complete information
                during registration and to update such information as needed.
              </li>
              <li>
                You must notify us immediately of any unauthorized use of your
                account at{" "}
                <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
              </li>
            </ul>
          </section>

          <section className="mb-12">
            <h2>4. Use of the Service</h2>

            <h3>4.1 Permitted Use</h3>
            <p>
              The Service is provided for educational purposes. You may use the
              Service to:
            </p>
            <ul>
              <li>
                Enroll in and participate in educational cohorts and programs;
              </li>
              <li>Access course materials, lessons, and assessments;</li>
              <li>Submit assessment responses and track your progress;</li>
              <li>
                Complete onboarding forms as required for enrollment.
              </li>
            </ul>

            <h3>4.2 Prohibited Conduct</h3>
            <p>You agree not to:</p>
            <ul>
              <li>
                Use the Service for any unlawful purpose or in violation of any
                applicable laws;
              </li>
              <li>
                Share your account credentials with any third party or allow
                others to access your account;
              </li>
              <li>
                Upload, post, or transmit any content that is offensive,
                defamatory, infringing, or otherwise objectionable;
              </li>
              <li>
                Attempt to interfere with, disrupt, or gain unauthorized access
                to the Service or its underlying infrastructure;
              </li>
              <li>
                Use automated tools (bots, scrapers) to access or extract data
                from the Service without our written permission;
              </li>
              <li>
                Impersonate another person or misrepresent your affiliation with
                any entity;
              </li>
              <li>
                Reproduce, distribute, or publicly display any content from the
                Service without authorization.
              </li>
            </ul>
          </section>

          <section className="mb-12">
            <h2>5. Intellectual Property</h2>
            <p>
              All content available through the Service, including but not
              limited to text, graphics, logos, videos, course materials,
              assessments, and software, is the property of {brand.name} or its
              licensors and is protected by United States and international
              copyright, trademark, and other intellectual property laws.
            </p>
            <p>
              You are granted a limited, non-exclusive, non-transferable license
              to access and use the content solely for your personal,
              non-commercial educational purposes. This license does not include
              the right to:
            </p>
            <ul>
              <li>Modify, adapt, or create derivative works;</li>
              <li>
                Download, copy, or distribute content except as expressly
                permitted;
              </li>
              <li>
                Use any content for commercial purposes without written consent.
              </li>
            </ul>
          </section>

          <section className="mb-12">
            <h2>6. User Content</h2>
            <p>
              You may submit content through the Service, including assessment
              answers, onboarding form responses, and profile information
              (&quot;User Content&quot;). By submitting User Content:
            </p>
            <ul>
              <li>
                You retain ownership of your User Content, but grant us a
                worldwide, non-exclusive, royalty-free license to use, store,
                display, and process your User Content as necessary to provide
                the Service;
              </li>
              <li>
                You represent that you have the right to submit such content and
                that it does not violate any third-party rights;
              </li>
              <li>
                You acknowledge that your onboarding responses and assessment
                submissions may be reviewed by program administrators and
                instructors.
              </li>
            </ul>
          </section>

          <section className="mb-12">
            <h2>7. Third-Party Services</h2>
            <p>
              The Service may integrate with third-party platforms, including but
              not limited to Google (for authentication) and GoHighLevel (for
              CRM functionality). Your use of these third-party services is
              subject to their respective terms and privacy policies. We are not
              responsible for the practices or content of third-party services.
            </p>
          </section>

          <section className="mb-12">
            <h2>8. Privacy</h2>
            <p>
              Your use of the Service is also governed by our{" "}
              <Link href="/privacy" className="text-primary">
                Privacy Policy
              </Link>
              , which is incorporated into these Terms by reference. Please
              review the Privacy Policy to understand how we collect, use, and
              protect your information.
            </p>
          </section>

          <section className="mb-12">
            <h2>9. Disclaimer of Warranties</h2>
            <p>
              THE SERVICE IS PROVIDED ON AN &quot;AS IS&quot; AND &quot;AS
              AVAILABLE&quot; BASIS WITHOUT WARRANTIES OF ANY KIND, EITHER
              EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES
              OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND
              NON-INFRINGEMENT.
            </p>
            <p>
              We do not warrant that the Service will be uninterrupted, secure,
              error-free, or that any defects will be corrected. We do not
              guarantee any specific learning outcomes from the use of the
              Service.
            </p>
          </section>

          <section className="mb-12">
            <h2>10. Limitation of Liability</h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT
              SHALL {brand.name.toUpperCase()}, ITS OFFICERS, DIRECTORS, EMPLOYEES, AGENTS,
              OR AFFILIATES BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
              CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO
              LOSS OF DATA, LOSS OF PROFITS, OR DAMAGES ARISING OUT OF YOUR USE
              OR INABILITY TO USE THE SERVICE, EVEN IF WE HAVE BEEN ADVISED OF
              THE POSSIBILITY OF SUCH DAMAGES.
            </p>
            <p>
              OUR TOTAL LIABILITY TO YOU FOR ALL CLAIMS ARISING OUT OF OR
              RELATING TO THE SERVICE SHALL NOT EXCEED THE AMOUNT YOU PAID US,
              IF ANY, IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.
            </p>
          </section>

          <section className="mb-12">
            <h2>11. Indemnification</h2>
            <p>
              You agree to indemnify, defend, and hold harmless {brand.name} and
              its officers, directors, employees, and agents from and against
              any claims, liabilities, damages, losses, and expenses (including
              reasonable attorneys&apos; fees) arising out of or related to: (a)
              your use of the Service; (b) your violation of these Terms; (c)
              your violation of any rights of a third party; or (d) any User
              Content you submit.
            </p>
          </section>

          <section className="mb-12">
            <h2>12. Termination</h2>
            <p>
              We may suspend or terminate your access to the Service at any time,
              with or without cause, and with or without notice. Upon
              termination:
            </p>
            <ul>
              <li>Your right to use the Service will immediately cease;</li>
              <li>
                We may delete your account and associated data, subject to our
                data retention obligations as described in our{" "}
                <Link href="/privacy" className="text-primary">
                  Privacy Policy
                </Link>
                ;
              </li>
              <li>
                Sections 5, 9, 10, 11, 13, and 14 of these Terms shall survive
                termination.
              </li>
            </ul>
          </section>

          <section className="mb-12">
            <h2>13. Governing Law and Dispute Resolution</h2>
            <p>
              These Terms shall be governed by and construed in accordance with
              the laws of the State of Delaware, United States, without regard
              to its conflict of law principles.
            </p>
            <p>
              Any dispute arising out of or relating to these Terms or the
              Service shall first be attempted to be resolved through good-faith
              negotiation. If the dispute cannot be resolved through negotiation
              within thirty (30) days, it shall be resolved by binding
              arbitration administered by the American Arbitration Association
              (AAA) in accordance with its Commercial Arbitration Rules. The
              arbitration shall take place in Delaware, United States, or
              remotely as agreed by the parties.
            </p>
            <p>
              YOU AGREE THAT ANY DISPUTE RESOLUTION PROCEEDINGS WILL BE
              CONDUCTED ON AN INDIVIDUAL BASIS AND NOT IN A CLASS, CONSOLIDATED,
              OR REPRESENTATIVE ACTION.
            </p>
          </section>

          <section className="mb-12">
            <h2>14. General Provisions</h2>
            <ul>
              <li>
                <strong>Entire agreement:</strong> These Terms, together with the
                Privacy Policy, constitute the entire agreement between you and
                {brand.name} regarding the Service.
              </li>
              <li>
                <strong>Severability:</strong> If any provision of these Terms is
                found to be unenforceable, the remaining provisions will continue
                in full force and effect.
              </li>
              <li>
                <strong>Waiver:</strong> Our failure to enforce any right or
                provision of these Terms shall not constitute a waiver of such
                right or provision.
              </li>
              <li>
                <strong>Assignment:</strong> You may not assign or transfer these
                Terms without our prior written consent. We may assign these
                Terms without restriction.
              </li>
            </ul>
          </section>

          <section className="mb-12">
            <h2>15. Contact Us</h2>
            <p>
              If you have any questions about these Terms, please contact us:
            </p>
            <ul>
              <li>
                <strong>Email:</strong>{" "}
                <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
              </li>
              <li>
                <strong>Address:</strong> {brandCityAddress}
              </li>
              <li>
                <strong>Website:</strong> <a href={siteUrl}>{siteUrl}</a>
              </li>
            </ul>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 py-8">
        <div className="max-w-4xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-400">
          <p>© {new Date().getFullYear()} {brand.name.replace(/^AI/, "AIS")}. All rights reserved.</p>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-primary transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-primary transition-colors">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
