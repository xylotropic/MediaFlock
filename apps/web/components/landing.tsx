"use client";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  SquarePen,
  ChartNoAxesCombined,
} from "lucide-react";
import { BotAvatar } from "bot-avatars";
import { Brand } from "./ui";
import { useReducedMotion } from "./effects";

export function Landing() {
  const reduced = useReducedMotion();
  return (
    <div className="landing">
      <header className="landing-nav">
        <Link href="/" aria-label="MediaFlock home">
          <Brand />
        </Link>
        <nav aria-label="Website navigation">
          <a href="#how-it-works">How it works</a>
          <Link href="/signin">Sign in</Link>
          <Link href="/signup" className="btn primary">
            Get started
            <ArrowUpRight size={14} />
          </Link>
        </nav>
      </header>
      <main>
        <section className="landing-hero" aria-labelledby="landing-title">
          <div>
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
            <div className="landing-actions">
              <Link href="/signup" className="btn primary">
                Create your account
                <ArrowRight size={16} />
              </Link>
              <Link href="/app" className="landing-secondary">
                Open MediaFlock
                <ArrowUpRight size={15} />
              </Link>
            </div>
          </div>
          <div className="landing-art" aria-hidden="true">
            <div className="landing-art-ring" />
            <BotAvatar
              type="clover"
              color="#c9c9c9"
              ink="#141414"
              saturation={0.5}
              size={260}
              theme="light"
              paused={reduced}
              interactive={false}
              jumpEvery={10}
            />
            <span className="landing-art-label">
              Your next post starts here.
            </span>
          </div>
        </section>
        <section
          id="how-it-works"
          className="landing-workflow"
          aria-labelledby="workflow-title"
        >
          <div className="landing-section-top">
            <span className="eyebrow">The workflow</span>
            <h2 id="workflow-title">One idea. More places to grow.</h2>
          </div>
          <div className="landing-steps">
            <article>
              <span className="landing-step-number">01</span>
              <SquarePen size={24} />
              <h3>Make it yours.</h3>
              <p>
                Bring your ideas, clips, and images. Create a version that fits
                each account.
              </p>
            </article>
            <article>
              <span className="landing-step-number">02</span>
              <CalendarDays size={24} />
              <h3>Give it a time.</h3>
              <p>
                Review your posts, approve the details, and schedule them on
                your calendar.
              </p>
            </article>
            <article>
              <span className="landing-step-number">03</span>
              <ChartNoAxesCombined size={24} />
              <h3>See what worked.</h3>
              <p>
                Check delivery and account performance. Use the results to plan
                your next post.
              </p>
            </article>
          </div>
        </section>
        <section className="landing-platforms">
          <p>Built for the accounts you use.</p>
          <div>
            YouTube <span>Instagram</span> TikTok <span>Facebook</span> LinkedIn{" "}
            <span>X</span>
          </div>
        </section>
        <section className="landing-faq" aria-labelledby="faq-title">
          <h2 id="faq-title">A few things to know.</h2>
          <div>
            <details>
              <summary>Can I write posts without AI?</summary>
              <p>
                Yes. Write and edit your own drafts. You can connect OpenAI if
                you want help creating variations.
              </p>
            </details>
            <details>
              <summary>How do I connect my accounts?</summary>
              <p>
                Open Connections, add your Post for Me key, and authorize your
                social accounts. You control which accounts and formats can
                publish.
              </p>
            </details>
            <details>
              <summary>Do my drafts publish right away?</summary>
              <p>
                No. You review and approve the exact post and publishing time
                before it can be scheduled.
              </p>
            </details>
          </div>
        </section>
        <section className="landing-cta">
          <h2>Make your next move.</h2>
          <Link href="/signup" className="btn primary">
            Get started
            <ArrowUpRight size={16} />
          </Link>
        </section>
      </main>
      <footer className="landing-footer">
        <Brand />
        <p>Create. Schedule. Grow.</p>
        <Link
          href="https://github.com/xylotropic/MediaFlock"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open source
          <ArrowUpRight size={13} />
        </Link>
      </footer>
    </div>
  );
}
