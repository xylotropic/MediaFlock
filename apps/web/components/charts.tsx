"use client";
import {
  EChartsBarChart,
  type ChartConfig,
} from "./evilcharts/charts/echarts-bar-chart";
import { useReducedMotion } from "./effects";
import { measurementLabel } from "../../../packages/analytics/metrics";
export function ObservationChart({
  observations,
  onInspect,
}: {
  observations: any[];
  onInspect: (row: any) => void;
}) {
  const reduced = useReducedMotion();
  const label = observations.length
    ? measurementLabel(observations[0])
    : "Post performance";
  const chartConfig: ChartConfig = {
    value: { label, colors: { light: ["#111111", "#797979"] } },
  };
  const data = observations.map((row, index) => ({
    index: String(index + 1),
    value: Number(row.value),
    row,
  }));
  return (
    <div
      className="observation-chart"
      aria-label={`${label} per post at 24 hours. Select a bar to inspect its evidence.`}
    >
      <EChartsBarChart
        data={data}
        config={chartConfig}
        renderer="svg"
        animation={!reduced}
        animationType="left-to-right"
        onDatumClick={(point) => onInspect(point.row)}
        chartOptions={{
          grid: { top: 18, right: 12, bottom: 34, left: 48 },
          textStyle: { fontFamily: "var(--font-geist-sans), sans-serif" },
        }}
      >
        <EChartsBarChart.Grid />
        <EChartsBarChart.XAxis dataKey="index" />
        <EChartsBarChart.YAxis
          tickFormatter={(value) =>
            Number(value) >= 1000
              ? (Number(value) / 1000).toFixed(1) + "k"
              : value
          }
        />
        <EChartsBarChart.Tooltip roundness="sm" />
        <EChartsBarChart.Bar
          dataKey="value"
          variant="default"
          radius={2}
          enableHoverHighlight
        />
      </EChartsBarChart>
    </div>
  );
}
