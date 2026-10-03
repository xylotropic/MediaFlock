import Link from "next/link";
import styles from "./public-footer.module.css";

export function PublicFooter() {
  return (
    <footer className={styles.footer}>
      <span>MediaFlockLLC</span>
      <Link href="/privacy">Privacy policy</Link>
    </footer>
  );
}
