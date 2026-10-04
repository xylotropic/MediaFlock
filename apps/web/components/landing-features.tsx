"use client";

import {
  CalendarDays,
  Check,
  LockKeyhole,
  SquarePen,
  ShieldCheck,
} from "lucide-react";
import dynamic from "next/dynamic";
import { ThinkingOrb } from "thinking-orbs";
import { PlatformMark, socialPlatforms } from "./platform-mark";
import styles from "./landing.module.css";

const LandingCharts = dynamic(() => import("./landing-charts"), { ssr: false });

export function LandingFeatures({ paused }: { paused: boolean }) {
  return (
    <section
      id="features"
      className={styles.features}
      aria-labelledby="features-title"
    >
      <div className={styles.featureHeading}>
        <h2 id="features-title">Create with a little more clarity.</h2>
        <p>From the first draft to the next post, keep the details together.</p>
      </div>
      <div className={styles.featureGrid}>
        <article
          className={`${styles.featureCard} ${styles.wideCard} ${styles.createCard}`}
        >
          <div
            className={`${styles.featureVisual} ${styles.createVisual}`}
            aria-hidden="true"
          >
            <svg
              className={styles.connectors}
              viewBox="0 0 600 240"
              fill="none"
            >
              <path d="M100 180C190 180 185 80 300 80S415 170 500 170" />
              <path d="M100 180H500" strokeDasharray="3 6" />
            </svg>
            <div className={`${styles.mediaTile} ${styles.videoTile}`}>
              <div className={styles.tileTop}>
                <PlatformMark icon={socialPlatforms[0].icon} />
                <span />
              </div>
              <div className={styles.videoArtwork}>
                <i />
                <i />
                <i />
              </div>
              <div className={styles.tileLines}>
                <i />
                <i />
              </div>
            </div>
            <div className={`${styles.mediaTile} ${styles.portraitTile}`}>
              <div className={styles.portraitArtwork}>
                <i />
                <i />
              </div>
              <div className={styles.tileTop}>
                <PlatformMark icon={socialPlatforms[1].icon} />
                <span />
              </div>
            </div>
            <div className={`${styles.mediaTile} ${styles.captionTile}`}>
              <SquarePen size={18} />
              <div className={styles.tileLines}>
                <i />
                <i />
                <i />
              </div>
              <div className={styles.captionPlatforms}>
                <PlatformMark icon={socialPlatforms[2].icon} />
                <PlatformMark icon={socialPlatforms[5].icon} />
              </div>
            </div>
            <ThinkingOrb
              state="composing"
              size={64}
              theme="light"
              color="#7056d8"
              paused={paused}
              className={styles.composeOrb}
            />
          </div>
          <div className={styles.featureCopy}>
            <h3>One idea. Every format.</h3>
            <p>
              Create platform-ready variations from your clips, images, and
              captions. Give each account a version that fits.
            </p>
          </div>
        </article>

        <article className={`${styles.featureCard} ${styles.scheduleCard}`}>
          <div
            className={`${styles.featureVisual} ${styles.scheduleVisual}`}
            aria-hidden="true"
          >
            <ThinkingOrb
              state="working"
              size={64}
              theme="light"
              color="#c45f42"
              paused={paused}
              className={styles.processOrb}
            />
            <div className={`${styles.queueItem} ${styles.queueDraft}`}>
              <span>
                <SquarePen size={14} />
                Draft
              </span>
              <i />
            </div>
            <div className={`${styles.queueItem} ${styles.queueReview}`}>
              <span>
                <Check size={14} />
                In review
              </span>
              <i />
            </div>
            <div className={`${styles.queueItem} ${styles.queueScheduled}`}>
              <span>
                <CalendarDays size={14} />
                Scheduled
              </span>
              <i />
            </div>
          </div>
          <div className={styles.featureCopy}>
            <h3>Approve, then schedule.</h3>
            <p>
              Review the exact post and publishing time before it joins your
              calendar.
            </p>
          </div>
        </article>

        <article className={`${styles.featureCard} ${styles.privateCard}`}>
          <div
            className={`${styles.featureVisual} ${styles.privateVisual}`}
            aria-hidden="true"
          >
            <div className={styles.vaultGrid} />
            <div className={styles.vaultRing} />
            <div className={styles.vaultRingOuter} />
            <div className={styles.vault}>
              <ThinkingOrb
                state="connecting"
                size={64}
                theme="light"
                color="#19836f"
                paused={paused}
              />
              <span className={styles.vaultLock}>
                <LockKeyhole size={21} strokeWidth={1.5} />
              </span>
            </div>
            <span className={styles.vaultFile}>
              <ShieldCheck size={14} />
              <i />
              <i />
            </span>
          </div>
          <div className={styles.featureCopy}>
            <h3>Your originals stay yours.</h3>
            <p>
              Keep source files separate from the versions you publish, inside
              your own workspace.
            </p>
          </div>
        </article>

        <article
          className={`${styles.featureCard} ${styles.wideCard} ${styles.insightsCard}`}
        >
          <div className={`${styles.featureVisual} ${styles.insightsVisual}`}>
            <LandingCharts paused={paused} />
            <div className={styles.deliveryPanel} aria-hidden="true">
              <Check size={14} />
              <span>Delivery</span>
              <i />
              <i />
            </div>
            <ThinkingOrb
              state="searching"
              size={64}
              theme="light"
              color="#387ccc"
              aria-hidden="true"
              paused={paused}
              className={styles.insightsOrb}
            />
          </div>
          <div className={styles.featureCopy}>
            <h3>Keep the whole picture.</h3>
            <p>
              See delivery and account performance together. Use what worked to
              plan your next post.
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}
