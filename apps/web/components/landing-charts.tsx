"use client";

import { useEffect, useRef, useState } from "react";
import {
  EChartsBarChart,
  type ChartConfig,
} from "./evilcharts/charts/echarts-bar-chart";
import styles from "./landing.module.css";

// Illustrative marketing data, separate from workspace analytics.
const activity = {
  week: [34, 58, 42, 76, 61, 88, 72].map((views, index) => ({
    day: ["M", "T", "W", "T", "F", "S", "S"][index],
    views,
  })),
  month: [42, 65, 78, 96].map((views, index) => ({
    day: `W${index + 1}`,
    views,
  })),
};
const platforms = [
  { platform: "YouTube", views: 82 },
  { platform: "Instagram", views: 63 },
  { platform: "TikTok", views: 74 },
];
const activityConfig = {
  views: {
    label: "Example activity",
    colors: { light: ["#8f73e8", "#537cd7"] },
  },
} satisfies ChartConfig;
const platformConfig = {
  views: { label: "Example views", colors: { light: ["#47adba", "#82c9ca"] } },
} satisfies ChartConfig;
const chartOptions = {
  grid: { left: 8, right: 8, top: 10, bottom: 24 },
};

export default function LandingCharts({ paused }: { paused: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [period, setPeriod] = useState<"week" | "month">("week");

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={host} className={styles.chartScene}>
      <div className={styles.activityPanel}>
        <div className={styles.chartHeading}>
          <span>Example activity</span>
          <button
            type="button"
            aria-label={`Show example ${period === "week" ? "monthly" : "weekly"} activity`}
            onClick={() => setPeriod(period === "week" ? "month" : "week")}
          >
            {period === "week" ? "Week" : "Month"}{" "}
            <span aria-hidden="true">↔</span>
          </button>
        </div>
        {visible && (
          <EChartsBarChart
            data={activity[period]}
            config={activityConfig}
            className={styles.activityChart}
            animation={!paused}
            chartOptions={chartOptions}
          >
            <EChartsBarChart.Grid />
            <EChartsBarChart.XAxis dataKey="day" hideDots />
            <EChartsBarChart.Tooltip />
            <EChartsBarChart.Bar dataKey="views" radius={4} glowing />
          </EChartsBarChart>
        )}
      </div>
      <div className={styles.accountPanel}>
        <span>Example platform views</span>
        {visible && (
          <EChartsBarChart
            data={platforms}
            config={platformConfig}
            layout="horizontal"
            xDataKey="platform"
            className={styles.platformChart}
            animation={!paused}
            chartOptions={{
              grid: { left: 72, right: 6, top: 4, bottom: 4 },
            }}
          >
            <EChartsBarChart.YAxis dataKey="platform" hideDots />
            <EChartsBarChart.Tooltip />
            <EChartsBarChart.Bar dataKey="views" variant="hatched" radius={4} />
          </EChartsBarChart>
        )}
      </div>
    </div>
  );
}
