import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Privacy policy" };

/* ---- Owner details: one edit away. ---- */
const OWNER_NAME = "Brayden";
/** Optional. Leave empty until there is an ABN; the line is hidden when empty. */
const ABN = "";
const CONTACT_EMAIL = "brayden.m.32@gmail.com";
const EFFECTIVE_DATE = "7 November 2026";

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-2 mt-9 scroll-mt-6 font-display text-[1.6rem] leading-tight text-ink">
      {children}
    </h2>
  );
}
const P = ({ children }: { children: React.ReactNode }) => <p className="mt-3 text-[16px] leading-relaxed text-ink-2">{children}</p>;
const UL = ({ children }: { children: React.ReactNode }) => (
  <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[16px] leading-relaxed text-ink-2 marker:text-ink-3">{children}</ul>
);
const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} className="font-medium text-primary underline underline-offset-2" {...(href.startsWith("http") ? { rel: "noopener noreferrer" } : {})}>
    {children}
  </a>
);

export default function PrivacyPage() {
  return (
    <div className="lg:pb-12">
      <PageHeader display title="Privacy policy" deck={`How Larder handles your information. In effect from ${EFFECTIVE_DATE}.`} />
      <article className="max-w-2xl px-5 pb-10 lg:px-0">
        <p className="rounded-2xl bg-primary-soft p-4 text-[16px] leading-relaxed text-ink">
          In short: Larder works on your device first and works without an account. Photos and pasted text are sent to an AI to be read and
          aren&apos;t kept. If you sign in and share a household, that household&apos;s food, history and profile are stored on a server in Sydney.
          There is no advertising and no analytics.
        </p>

        <H2 id="who">Who we are</H2>
        <P>
          Larder is run by {OWNER_NAME}
          {ABN ? ` (ABN ${ABN})` : ""}. We follow the Privacy Act 1988 (Cth) and the Australian Privacy Principles (APPs). Questions, access
          requests and complaints go to <A href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</A>.
        </P>

        <H2 id="collect">What we collect</H2>
        <UL>
          <li>
            <strong className="text-ink">On your device:</strong> your food, storage spots, history, shopping list, saved recipes, meal plan,
            settings, and your nutrition log. The nutrition log never leaves your device.
          </li>
          <li>
            <strong className="text-ink">If you sign in:</strong> your email address (or Google account email), a display name you choose, and
            the household you belong to. Your household&apos;s food, history, recipes, plan and profile are stored so members can share them.
          </li>
          <li>
            <strong className="text-ink">If you turn on reminders:</strong> a push subscription for your browser (an address issued by your
            browser&apos;s push service, with keys), your reminder time zone and schedule.
          </li>
          <li>
            <strong className="text-ink">When you scan or paste:</strong> the photo or text you choose to send, only to read it (see below).
          </li>
          <li>
            <strong className="text-ink">Technical data:</strong> our host and database keep ordinary server logs (such as IP address and time)
            for security and to keep things running.
          </li>
        </UL>
        <P>We don&apos;t collect your location, contacts or advertising identifiers, and we don&apos;t use analytics or tracking cookies.</P>

        <H2 id="sensitive">Sensitive information</H2>
        <P>
          Allergies are health information. Halal, kosher or vegan choices can reveal religious or philosophical beliefs. Both are sensitive
          information under the Privacy Act. We only collect them if you choose to enter them, and we ask you to tick a consent box first.
          They&apos;re used to filter recipes and to write recipe ideas, nothing else.
        </P>
        <P>
          Everyone in your household can see the household profile, including diets and allergies. Only add another person&apos;s details with
          their OK. If you ask for AI recipe ideas, diets, allergies, likes and dislikes are sent with the request, unless you turn that off in
          Settings (&quot;Include allergies and diets in AI recipe requests&quot;). You can withdraw consent at any time by removing the details
          in Settings or by deleting your account.
        </P>

        <H2 id="why">Why we use it</H2>
        <UL>
          <li>To show what to eat first, estimate dates, and suggest recipes.</li>
          <li>To sync a household between its members&apos; devices.</li>
          <li>To send the reminders you ask for.</li>
          <li>To read photos and text you give us.</li>
          <li>To keep the service secure and fix problems.</li>
        </UL>
        <P>We don&apos;t sell your information or use it for marketing.</P>

        <H2 id="disclose">Who we share it with</H2>
        <UL>
          <li>
            <strong className="text-ink">Supabase</strong> (database and sign-in), in Sydney, Australia: account and household data.
          </li>
          <li>
            <strong className="text-ink">Vercel</strong> (hosting), with our functions running in Sydney: requests pass through it, including
            photos and text on their way to the AI.
          </li>
          <li id="anthropic" className="scroll-mt-6">
            <strong className="text-ink">Anthropic</strong> (AI), in the United States: photos you scan, text you paste (with email addresses,
            phone numbers, street addresses, names in greetings and order or card numbers removed first), recipe pages or photos you import, and
            your food list and, unless turned off, your household&apos;s diets and allergies when you ask for recipe ideas. Larder does not store
            these. We use Anthropic&apos;s commercial API, whose terms say API data isn&apos;t used to train models and is kept only briefly for
            safety and abuse checks. Check Anthropic&apos;s current commercial terms for the exact retention period.
          </li>
          <li>
            <strong className="text-ink">Open Food Facts</strong>: the barcode you scan, to look up the product.
          </li>
          <li>
            <strong className="text-ink">TheMealDB</strong>: your search word when you search online recipes; recipe images load straight from
            them into your browser, which shows them your IP address.
          </li>
          <li>
            <strong className="text-ink">Your browser&apos;s push service</strong> (for example Google, Apple or Mozilla): the reminder message
            you asked for.
          </li>
          <li>
            <strong className="text-ink">Other household members:</strong> your display name (not your email address), and the household&apos;s
            food, history and profile.
          </li>
        </UL>
        <P>We may also disclose information if the law requires it.</P>

        <H2 id="overseas">Overseas disclosure (APP 8)</H2>
        <P>
          Photos, pasted text and recipe requests are sent to Anthropic in the United States. Recipe images and search words go to TheMealDB, and
          barcodes to Open Food Facts, whose servers may be outside Australia. Browser push services may route messages overseas. By choosing to
          scan, paste, import, ask for ideas or search, you agree to that disclosure. We can&apos;t control how those providers handle
          information under their own policies. Each is bound by its own terms to protect what it receives.
        </P>

        <H2 id="anonymity">Using Larder without an account</H2>
        <P>
          You don&apos;t need an account. Without one, everything stays in your browser, except what you choose to send for reading, recipe
          search or barcode lookup. An account is only needed for sharing a household, background reminders and AI features.
        </P>

        <H2 id="automated">Automated processing</H2>
        <P>
          An AI reads photos and text, and recipes are filtered automatically against the allergies you list. Both can be wrong: the AI can
          misread a label, and a recipe filter can miss an ingredient. Always check labels and ingredients yourself. Dates are estimates;
          printed dates win.
        </P>

        <H2 id="security">Security</H2>
        <P>
          Data is encrypted in transit. Household data is protected by row-level access rules so only members can read it. Invites are
          single-use and expire. We limit who can access the database. No system is perfectly secure; if there&apos;s a breach likely to cause
          serious harm we&apos;ll tell you and the OAIC as the law requires.
        </P>

        <H2 id="retention">How long we keep it</H2>
        <UL>
          <li>Photos and pasted text: not kept by Larder.</li>
          <li>Household data: until the last member leaves the household or it is deleted.</li>
          <li>Your account: until you delete it on the Account page, which removes your membership and reminder subscriptions.</li>
          <li>Sign-ups never confirmed: removed after 7 days.</li>
          <li>Expired invites: removed after 30 days.</li>
          <li>On your device: until you erase it in Settings or clear your browser&apos;s data.</li>
        </UL>
        <P>
          &quot;Erase everything&quot; in Settings clears this device only. Copies on the server stay until you leave the household or delete
          your account. Backups kept by our providers may take a short time to expire.
        </P>

        <H2 id="access">Access, correction and export</H2>
        <P>
          You can see and edit most of your information in the app. Settings → Back up and restore exports a copy, including (when signed in)
          your membership and reminder subscriptions. For anything else, or to ask us to correct or delete something, email{" "}
          <A href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</A>. We&apos;ll reply within 30 days, and won&apos;t charge for asking.
        </P>

        <H2 id="children">Children</H2>
        <P>
          Account holders must be 16 or older. Younger people may be part of a parent&apos;s household (for example, a child&apos;s allergy), but
          the parent or guardian adds and looks after those details.
        </P>

        <H2 id="complaints">Complaints</H2>
        <P>
          If you&apos;re unhappy with how we handled your information, email <A href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</A> and we&apos;ll
          respond within 30 days. If you&apos;re still not satisfied, you can complain to the Office of the Australian Information Commissioner:{" "}
          <A href="https://www.oaic.gov.au">oaic.gov.au</A>, 1300 363 992.
        </P>

        <H2 id="changes">Changes</H2>
        <P>
          We may update this policy. The date at the top shows the latest version, in effect from {EFFECTIVE_DATE}. We&apos;ll point out
          significant changes in the app.
        </P>
      </article>
    </div>
  );
}
