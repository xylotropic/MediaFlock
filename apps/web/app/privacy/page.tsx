import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "../../components/ui";
import { PublicFooter } from "../../components/public-footer";
import styles from "./privacy.module.css";

export const metadata: Metadata = {
  title: "Privacy policy · MediaFlock",
  description: "How MediaFlock collects, uses, stores, and shares information.",
};

export default function PrivacyPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" aria-label="MediaFlock home">
          <Brand />
        </Link>
        <Link href="/">Back to MediaFlock</Link>
      </header>
      <main className={styles.content}>
        <p className={styles.date}>Last updated October 3, 2026</p>
        <h1>Privacy policy</h1>
        <p className={styles.introduction}>
          MediaFlock helps brands create, review, schedule, and understand their
          social content. This policy describes information handled by the
          MediaFlock website and hosted workspace.
        </p>
        <section aria-labelledby="information-title">
          <h2 id="information-title">Information we collect</h2>
          <p>
            Account information includes your email address, profile name,
            authentication records, workspace membership, and timezone. Supabase
            Auth handles passwords and sign-in sessions.
          </p>
          <p>
            Workspace information includes uploaded images and videos, file
            metadata and checksums, captions, drafts, writing guidance,
            approvals, schedules, publication results, and activity records.
            Connected accounts can add platform identifiers, account names,
            permissions, connection records, and post performance metrics.
          </p>
          <p>
            The app and its hosting services process technical information such
            as request times, IP addresses, browser information, error records,
            and security events. MediaFlock stores hashes of addresses and email
            identifiers used for account request limits.
          </p>
        </section>
        <section aria-labelledby="use-title">
          <h2 id="use-title">How we use information</h2>
          <p>
            We use information to authenticate users, keep workspaces separate,
            store and process media, provide drafts and scheduling, record
            approvals, deliver approved posts, retrieve available performance
            data, and investigate failures or misuse. Workspace membership and
            permissions restrict access. Owners manage credentials and
            publication permissions.
          </p>
          <p>
            We do not sell personal information or use it for targeted
            advertising.
          </p>
        </section>
        <section aria-labelledby="services-title">
          <h2 id="services-title">Services that receive information</h2>
          <p>
            Vercel hosts the website and API. Supabase provides authentication,
            the database, and private media storage. An operator-managed worker
            processes uploaded media and background jobs. These services receive
            information needed to perform their roles.
          </p>
          <p>
            When a workspace owner connects Post for Me and social accounts,
            account details and approved content can be sent to Post for Me and
            the selected platforms for connection, publication, and analytics.
            Published content is subject to the destination platform’s privacy
            settings and policies.
          </p>
          <p>
            If an owner enables OpenAI, the requested drafting or analysis
            context is sent to OpenAI. This can include source text, writing
            guidance, captions, and selected performance observations. Manual
            drafting is available without this integration. Connecting a service
            can involve processing in the locations where that service operates;
            its own privacy policy also applies.
          </p>
          <p>
            Information may also be disclosed when required by law or necessary
            to protect accounts, investigate abuse, or respond to a security
            incident.
          </p>
        </section>
        <section aria-labelledby="browser-title">
          <h2 id="browser-title">Cookies and browser storage</h2>
          <p>
            Essential cookies support sign-in, account recovery when enabled,
            and temporary account connection flows. Browser storage remembers
            preferences such as whether the sidebar is collapsed. The app does
            not include advertising trackers or third-party website analytics
            scripts. Blocking essential cookies can prevent sign-in; clearing
            browser data does not delete stored workspace information.
          </p>
        </section>
        <section aria-labelledby="storage-title">
          <h2 id="storage-title">Storage, security, and retention</h2>
          <p>
            Uploaded originals and generated files are kept in private storage.
            Authorized downloads use temporary links. Public access uses HTTPS;
            workspace permissions restrict application access, and stored
            integration credentials are encrypted.
          </p>
          <p>
            Workspace content, original uploads, approval records, publication
            history, and security records are retained while the workspace is
            operated. Signing out or disconnecting a social account does not
            automatically delete these records. Deletion currently requires
            administrator assistance. Backups and records held by service
            providers may follow separate retention periods. Removing data from
            MediaFlock does not automatically remove posts already published to
            another platform.
          </p>
        </section>
        <section aria-labelledby="choices-title">
          <h2 id="choices-title">Your choices and privacy requests</h2>
          <p>
            You can change your password, disconnect social accounts, revoke
            platform permissions, and ask your workspace administrator to
            review, correct, export, or delete your information. Do not upload
            personal information that you lack permission to use or publish.
          </p>
          <p>
            For privacy questions and requests, contact the administrator who
            provided your workspace access. Public registration and email-based
            recovery are currently closed while email delivery is being
            configured.
          </p>
        </section>
        <section aria-labelledby="changes-title">
          <h2 id="changes-title">Changes to this policy</h2>
          <p>
            We will update this page when our information practices change and
            revise the date above. Material changes affecting existing workspace
            data will be communicated to workspace administrators.
          </p>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
