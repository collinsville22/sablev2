"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchAllVaults,
  fetchVaultPerformance,
  type LiveVault,
} from "@/lib/api/vaults";
import type { PerformanceDataPoint } from "@/lib/types";

const REFRESH_INTERVAL = 60_000;

export function useVaults() {
  const [vaults, setVaults] = useState<LiveVault[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchAllVaults();
      setVaults(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch vaults");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [refresh]);

  return { vaults, loading, error, refresh };
}

export function useVaultDetail(vaultId: string) {
  const { vaults, loading, error } = useVaults();
  const vault = vaults.find((v) => v.id === vaultId) ?? null;
  return { vault, loading, error };
}

export function usePerformanceData(vaultId: string, days: number = 30) {
  const [data, setData] = useState<PerformanceDataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchVaultPerformance(vaultId, days)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [vaultId, days]);

  return { data, loading };
}

/** IDs of vaults that are shown on specialized pages (Privacy), not the main vault listing */
const HIDDEN_FROM_STATS = new Set(["stablecoin"]);

export function useProtocolStats() {
  const { vaults, loading } = useVaults();

  // Exclude stablecoin vault from main page stats (it lives on the Privacy page)
  const listed = vaults.filter((v) => !HIDDEN_FROM_STATS.has(v.id));

  const totalTvl = listed.reduce((sum, v) => sum + v.tvlUsd, 0);
  const avgApy =
    totalTvl > 0
      ? listed.reduce((sum, v) => sum + v.apy.total * v.tvlUsd, 0) / totalTvl
      : listed.length > 0
        ? listed.reduce((sum, v) => sum + v.apy.total, 0) / listed.length
        : 0;

  return {
    totalTvl,
    avgApy,
    vaultCount: listed.length,
    loading,
  };
}
