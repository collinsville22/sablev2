"use client";

import { useState, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { clsx } from "clsx";
import type { PerformanceDataPoint } from "@/lib/types";

const RANGES = [
  { value: 7, label: "7D" },
  { value: 30, label: "30D" },
  { value: 90, label: "90D" },
] as const;

export function PerformanceChart({
  data,
  dataKey = "sharePrice",
}: {
  data: PerformanceDataPoint[];
  dataKey?: "sharePrice" | "tvl" | "apy";
}) {
  const [range, setRange] = useState<7 | 30 | 90>(30);

  const filtered = useMemo(() => {
    const cutoff = Date.now() - range * 86_400_000;
    return data.filter((d) => d.timestamp >= cutoff);
  }, [data, range]);

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const formatValue = (val: number) => {
    if (dataKey === "tvl") return `$${(val / 1_000_000).toFixed(2)}M`;
    if (dataKey === "apy") return `${val.toFixed(2)}%`;
    return val.toFixed(4);
  };

  const titles: Record<string, string> = {
    sharePrice: "Share Price",
    tvl: "TVL",
    apy: "APY",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
          {titles[dataKey]}
        </p>
        <div className="flex items-center gap-px rounded-md overflow-hidden border border-line">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={clsx(
                "px-2 py-1 text-[10px] font-mono transition-colors",
                range === r.value
                  ? "bg-surface-raised text-fg"
                  : "text-fg-dim hover:text-fg-muted"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={filtered}>
            <defs>
              <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#F7931A" stopOpacity={0.12} />
                <stop offset="100%" stopColor="#F7931A" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatDate}
              stroke="#484B5B"
              fontSize={10}
              fontFamily="var(--font-geist-mono)"
              tickLine={false}
              axisLine={false}
              minTickGap={50}
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={formatValue}
              stroke="#484B5B"
              fontSize={10}
              fontFamily="var(--font-geist-mono)"
              tickLine={false}
              axisLine={false}
              width={55}
            />
            <Tooltip
              contentStyle={{
                background: "#131519",
                border: "1px solid #1e2028",
                borderRadius: 8,
                fontSize: 11,
                fontFamily: "var(--font-geist-mono)",
                padding: "8px 12px",
                color: "#E8E9EC",
              }}
              labelStyle={{ color: "#484B5B", marginBottom: 4 }}
              labelFormatter={(val) =>
                new Date(val as number).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })
              }
              formatter={(val: number) => [formatValue(val), ""]}
              cursor={{ stroke: "#F7931A", strokeWidth: 1, strokeDasharray: "4 4" }}
            />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke="#F7931A"
              strokeWidth={1.5}
              fill="url(#chartFill)"
              dot={false}
              activeDot={{ r: 3, fill: "#F7931A", stroke: "#060608", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
