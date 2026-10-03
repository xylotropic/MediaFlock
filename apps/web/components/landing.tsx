"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, ArrowUpRight, Pause, Play } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import { Brand } from "./ui";
import { useReducedMotion } from "./effects";
import { LandingFeatures } from "./landing-features";
import { PlatformMark, socialPlatforms } from "./platform-mark";
import styles from "./landing.module.css";

export function Landing() {
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const motionPaused = reduced || paused;

  return (
    <div
      className={styles.landing}
      data-motion={motionPaused ? "paused" : "on"}
    >
      <header className={styles.navigation}>
        <Link href="/" aria-label="MediaFlock home">
          <Brand />
        </Link>
        <nav aria-label="Website navigation">
          <a href="#features" className={styles.featuresLink}>
            Features
          </a>
          <Link href="/signin">Sign in</Link>
          <Link href="/signup" className="btn primary">
            Get started
            <ArrowUpRight size={14} />
          </Link>
        </nav>
      </header>

      <main>
        <section className={styles.hero} aria-labelledby="landing-title">
          <div className={styles.heroCopy}>
            <h1 id="landing-title">
              Make it.
              <br />
              Schedule it.
              <br />
              <span>Go viral.</span>
            </h1>
            <p>
              MediaFlock is a next generation Social Media Harness built for
              brands trying to scale.
            </p>
            <div className={styles.actions}>
              <Link href="/signup" className="btn primary">
                Create your account
                <ArrowRight size={16} />
              </Link>
              <Link href="/app" className={styles.secondaryLink}>
                Open MediaFlock
                <ArrowUpRight size={15} />
              </Link>
            </div>
          </div>
          <div className={styles.heroArt} aria-hidden="true">
            <div className={styles.heroGrid} />
            <div className={styles.heroOrbit} />
            <div className={styles.heroOrbitInner} />
            <span className={`${styles.heroPlatform} ${styles.heroYoutube}`}>
              <PlatformMark icon={socialPlatforms[0].icon} />
            </span>
            <span className={`${styles.heroPlatform} ${styles.heroInstagram}`}>
              <PlatformMark icon={socialPlatforms[1].icon} />
            </span>
            <span className={`${styles.heroPlatform} ${styles.heroTiktok}`}>
              <PlatformMark icon={socialPlatforms[2].icon} />
            </span>
            <div className={styles.heroOrb}>
              <ThinkingOrb
                state="composing"
                size={64}
                theme="light"
                paused={motionPaused}
              />
            </div>
            <span className={styles.heroArtLabel}>
              Your next post starts here.
            </span>
          </div>
        </section>

        <section className={styles.platforms} aria-labelledby="platforms-title">
          <div className={styles.platformHeading}>
            <div>
              <h2 id="platforms-title">Your audience. Your platforms.</h2>
              <p>A single workspace for the accounts you use.</p>
            </div>
            <button
              type="button"
              className={styles.motionButton}
              onClick={() => setPaused(!paused)}
              disabled={reduced}
              aria-pressed={motionPaused}
              aria-label={
                reduced
                  ? "Animations are off because of your motion preference"
                  : paused
                    ? "Play page animations"
                    : "Pause page animations"
              }
            >
              {motionPaused ? <Play size={12} /> : <Pause size={12} />}
              {reduced ? "Motion off" : paused ? "Play motion" : "Pause motion"}
            </button>
          </div>
          <div className={styles.marquee}>
            <div className={styles.marqueeTrack}>
              {[0, 1, 2].map((group) => (
                <ul
                  className={styles.logoGroup}
                  key={group}
                  aria-hidden={group > 0 ? true : undefined}
                >
                  {socialPlatforms.map((platform) => (
                    <li key={platform.name}>
                      <PlatformMark icon={platform.icon} />
                      <span>{platform.name}</span>
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </div>
        </section>

        <LandingFeatures paused={motionPaused} />
      </main>
    </div>
  );
}
