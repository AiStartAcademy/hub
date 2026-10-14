import type { Metadata } from "next";
import Link from "next/link";
import { MobileMenuButton } from '@/components/MobileMenuButton';
import { brand, brandCityAddress } from "@/config/brand";

export const metadata: Metadata = {
  title: `Privacy Policy — ${brand.shortName}`,
  description:
    `${brand.shortName} Privacy Policy. Learn how we collect, use, and protect your personal information.`,
};

export default function PrivacyPolicyPage() {
  const lastUpdated = "March 11, 2026";
  const contactEmail = brand.email.privacy;
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
            ← {brand.shortName}
          </Link>
          <nav className="flex gap-3 md:gap-6 text-sm">
            <Link
              href="/terms"
              className="text-slate-500 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary rounded transition-colors min-h-[44px] flex items-center"
            >
              <span className="hidden sm:inline">Terms of Service</span>
              <span className="sm:hidden">Terms</span>
            </Link>
            <Link
              href="/privacy"
              className="text-primary font-semibold focus-visible:ring-2 focus-visible:ring-primary rounded transition-colors min-h-[44px] flex items-center"
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
            Privacy Policy
          </h1>
          <p className="text-slate-500 dark:text-slate-400">
            Last updated: {lastUpdated}
          </p>
        </div>

        <div className="prose prose-slate dark:prose-invert max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-a:text-primary prose-a:no-underline hover:prose-a:underline">
          <section className="mb-12">
            <h2>1. Introduction</h2>
            <p>
              {brand.legalName} (&quot;{brand.shortName},&quot; &quot;we,&quot;
              &quot;us,&quot; or &quot;our&quot;), located at {brandCityAddress}, operates the website located at{" "}
              <a href={siteUrl}>{siteUrl}</a> (the &quot;Service&quot;). This
              Privacy Policy explains how we collect, use, disclose, and
              safeguard your personal information when you use our Service,
              including our learning management system, onboarding forms, and
              related features.
            </p>
            <p>
              By accessing or using the Service, you agree to the terms of this
              Privacy Policy. If you do not agree with the practices described
              herein, please do not use the Service.
            </p>
          </section>

          <section className="mb-12">
            <h2>2. Information We Collect</h2>

            <h3>2.1 Information You Provide Directly</h3>
            <ul>
              <li>
                <strong>Account information:</strong> Full name, email address,
                and password when you create an account.
              </li>
              <li>
                <strong>Profile information:</strong> Timezone preferences and
                profile image.
              </li>
              <li>
                <strong>Onboarding data:</strong> Responses you provide through
                our onboarding forms, which may include contact details such as
                phone number and additional information relevant to your
                enrollment.
              </li>
              <li>
                <strong>Assessment submissions:</strong> Answers and scores from
                course assessments.
              </li>
              <li>
                <strong>Communications:</strong> Any information you provide
                when contacting us for support.
              </li>
            </ul>

            <h3>2.2 Information Collected Automatically</h3>
            <ul>
              <li>
                <strong>Log data:</strong> IP address, browser type, operating
                system, referral URLs, pages viewed, and dates/times of access.
              </li>
              <li>
                <strong>Cookies and similar technologies:</strong> We use
                essential cookies for authentication and session management,
                and — only with your consent — analytics and advertising
                cookies. See Section 7 for more details.
              </li>
            </ul>

            <h3>2.3 Information from Third Parties</h3>
            <ul>
              <li>
                <strong>Google OAuth:</strong> If you sign in with Google, we
                receive your name, email address, and profile picture from
                Google, subject to your Google account settings.
              </li>
            </ul>
          </section>

          <section className="mb-12">
            <h2>3. How We Use Your Information</h2>
            <p>We use the information we collect to:</p>
            <ul>
              <li>Create and manage your account;</li>
              <li>
                Provide, operate, and maintain the learning management system;
              </li>
              <li>
                Enroll you in cohorts, groups, and programs and track your
                educational progress;
              </li>
              <li>Process and evaluate assessment submissions;</li>
              <li>
                Send transactional emails, including account verification, cohort
                updates, and session reminders;
              </li>
              <li>
                Synchronize your information with third-party platforms (e.g.,
                GoHighLevel) when configured by program administrators;
              </li>
              <li>
                Improve and personalize the Service, including analyzing usage
                trends;
              </li>
              <li>
                Respond to your inquiries and provide customer support;
              </li>
              <li>Comply with applicable laws and legal obligations.</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2>4. Legal Bases for Processing (Where Applicable)</h2>
            <p>We process personal information based on:</p>
            <ul>
              <li>
                <strong>Contract performance:</strong> To provide the Service as
                agreed in our Terms of Service.
              </li>
              <li>
                <strong>Legitimate interests:</strong> To improve the Service,
                prevent fraud, and ensure security.
              </li>
              <li>
                <strong>Consent:</strong> Where you have provided explicit
                consent (e.g., onboarding form submissions).
              </li>
              <li>
                <strong>Legal obligations:</strong> To comply with applicable
                laws and regulations.
              </li>
            </ul>
          </section>

          <section className="mb-12">
            <h2>5. How We Share Your Information</h2>
            <p>
              We do not sell your personal information. We may share your
              information in the following circumstances:
            </p>
            <ul>
              <li>
                <strong>Service providers:</strong> We share data with
                third-party service providers who assist us in operating the
                Service, such as email delivery services (SMTP), authentication
                providers (Google OAuth), and CRM platforms (GoHighLevel).
              </li>
              <li>
                <strong>Program administrators and instructors:</strong> Your
                enrollment data, assessment results, and onboarding responses may
                be visible to instructors and administrators of cohorts you are
                enrolled in.
              </li>
              <li>
                <strong>Legal requirements:</strong> We may disclose information
                if required by law, subpoena, court order, or government
                request.
              </li>
              <li>
                <strong>Business transfers:</strong> In the event of a merger,
                acquisition, or sale of assets, your information may be
                transferred to the acquiring entity.
              </li>
            </ul>
          </section>

          <section className="mb-12">
            <h2>6. Data Retention</h2>
            <p>
              We retain your personal information for as long as your account is
              active or as needed to provide the Service. We may also retain
              certain information as required by law or for legitimate business
              purposes, such as fraud prevention and record-keeping. When
              personal information is no longer needed, we will securely delete
              or anonymize it.
            </p>
          </section>

          <section className="mb-12">
            <h2>7. Cookies and Tracking Technologies</h2>
            <p>
              We use the following types of cookies:
            </p>
            <ul>
              <li>
                <strong>Essential cookies:</strong> Required for authentication,
                session management, and core functionality. These cannot be
                disabled.
              </li>
              <li>
                <strong>Functional cookies:</strong> Used to remember your
                preferences (e.g., dark/light theme, timezone).
              </li>
              <li>
                <strong>Analytics cookies:</strong> Google Analytics 4, loaded
                through Google Tag Manager, to measure page views, clicks, and
                sign-up/checkout steps so we can improve the platform.
              </li>
              <li>
                <strong>Advertising cookies:</strong> Meta (Facebook) pixel
                tags, loaded through Google Tag Manager, to measure which
                campaigns bring people to us.
              </li>
            </ul>
            <p>
              Analytics and advertising cookies are <strong>off by default</strong>{" "}
              and are only set after you choose &quot;Accept All&quot; in our
              cookie banner. We implement Google Consent Mode v2, so until you
              accept, these tags are denied storage and no advertising or
              conversion events are sent. Declining, or dismissing the banner
              without accepting, keeps them off. You can change your choice at
              any time by clearing this site&apos;s data in your browser, which
              makes the banner reappear.
            </p>
          </section>

          <section className="mb-12">
            <h2>8. Your Rights and Choices</h2>

            <h3>8.1 All Users</h3>
            <ul>
              <li>
                <strong>Access and correction:</strong> You can access and update
                your account information through your account settings.
              </li>
              <li>
                <strong>Account deletion:</strong> You may request deletion of
                your account by contacting us at{" "}
                <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
              </li>
              <li>
                <strong>Email opt-out:</strong> You may opt out of non-essential
                communications by following the unsubscribe link in our emails.
              </li>
            </ul>

            <h3>8.2 California Residents (CCPA/CPRA)</h3>
            <p>
              If you are a California resident, you have additional rights under
              the California Consumer Privacy Act (CCPA) and the California
              Privacy Rights Act (CPRA):
            </p>
            <ul>
              <li>
                <strong>Right to know:</strong> You may request information about
                the categories and specific pieces of personal information we
                have collected about you.
              </li>
              <li>
                <strong>Right to delete:</strong> You may request that we delete
                your personal information, subject to certain exceptions.
              </li>
              <li>
                <strong>Right to correct:</strong> You may request correction of
                inaccurate personal information.
              </li>
              <li>
                <strong>Right to opt out of sale/sharing:</strong> We do not
                sell your personal information for money. If you accept
                analytics and advertising cookies, our advertising tags may
                share identifiers with Google and Meta in a way that counts as
                &quot;sharing&quot; for cross-context behavioral advertising
                under the CPRA. You can opt out at any time by declining our
                cookie banner, which stops that sharing; analytics and
                advertising tags are off until you accept.
              </li>
              <li>
                <strong>Right to non-discrimination:</strong> We will not
                discriminate against you for exercising any of your CCPA/CPRA
                rights.
              </li>
            </ul>
            <p>
              To exercise these rights, please contact us at{" "}
              <a href={`mailto:${contactEmail}`}>{contactEmail}</a>. We will
              verify your identity before processing any request.
            </p>

            <h3>8.3 Other US State Privacy Rights</h3>
            <p>
              Residents of Virginia (VCDPA), Colorado (CPA), Connecticut (CTDPA),
              Utah (UCPA), and other states with applicable privacy legislation
              may have similar rights, including the right to access, correct,
              delete, and opt out of the processing of personal data. To
              exercise these rights, contact us at{" "}
              <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
            </p>
          </section>

          <section className="mb-12">
            <h2>9. Data Security</h2>
            <p>
              We implement industry-standard security measures to protect your
              personal information, including:
            </p>
            <ul>
              <li>Encryption of passwords using bcrypt hashing;</li>
              <li>HTTPS encryption for all data in transit;</li>
              <li>Secure session management with NextAuth.js;</li>
              <li>
                Access controls limiting data access to authorized personnel.
              </li>
            </ul>
            <p>
              However, no method of transmission over the Internet or electronic
              storage is 100% secure. While we strive to use commercially
              acceptable means to protect your personal information, we cannot
              guarantee absolute security.
            </p>
          </section>

          <section className="mb-12">
            <h2>10. Children&apos;s Privacy</h2>
            <p>
              The Service is not directed to children under the age of 13. We do
              not knowingly collect personal information from children under 13.
              If you are a parent or guardian and believe that your child has
              provided us with personal information, please contact us at{" "}
              <a href={`mailto:${contactEmail}`}>{contactEmail}</a>, and we will
              take steps to delete such information. If you are between 13 and
              18 years of age, you may use the Service only with the involvement
              of a parent or guardian.
            </p>
          </section>

          <section className="mb-12">
            <h2>11. Third-Party Services</h2>
            <p>
              Our Service integrates with the following third-party services:
            </p>
            <ul>
              <li>
                <strong>Google (OAuth):</strong> For account authentication.
                Google&apos;s privacy policy is available at{" "}
                <a
                  href="https://policies.google.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  https://policies.google.com/privacy
                </a>
                .
              </li>
              <li>
                <strong>GoHighLevel:</strong> For CRM integration and contact
                synchronization, as configured by program administrators.
              </li>
            </ul>
            <p>
              We encourage you to review the privacy policies of these
              third-party services.
            </p>
          </section>

          <section className="mb-12">
            <h2>12. Changes to This Privacy Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify
              you of any material changes by posting the updated policy on this
              page and updating the &quot;Last updated&quot; date. Your continued
              use of the Service after any changes constitutes acceptance of the
              updated Privacy Policy.
            </p>
          </section>

          <section className="mb-12">
            <h2>13. Contact Us</h2>
            <p>
              If you have any questions about this Privacy Policy or our data
              practices, please contact us:
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
                <strong>Website:</strong>{" "}
                <a href={siteUrl}>{siteUrl}</a>
              </li>
            </ul>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 py-8">
        <div className="max-w-4xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-400">
          <p>© {new Date().getFullYear()} {brand.shortName}. All rights reserved.</p>
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
