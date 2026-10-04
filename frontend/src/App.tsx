import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Header } from '@/components/layout/Header';
import { StatsStrip, type BatchStats } from '@/components/layout/StatsStrip';
import { PasteTextInput, type StagedText } from '@/components/input/PasteTextInput';
import { ConfigBar } from '@/components/input/ConfigBar';
import { ResultsHeader, type FilterCounts } from '@/components/results/ResultsHeader';
import { EmptyState } from '@/components/results/EmptyState';
import { SourceGroup } from '@/components/results/SourceGroup';
import { useBatchExtract } from '@/hooks/useBatchExtract';
import { useUiStore } from '@/store/uiStore';
import { needsReview } from '@/utils/confidence';

const queryClient = new QueryClient();

function AppShell() {
  const { t } = useTranslation();
  const { preset, instructions, filter } = useUiStore();
  const [staged, setStaged] = useState<StagedText[]>([]);
  const { mutate, data: sources = [], isPending, error } = useBatchExtract();

  function handleAdd(text: string) {
    setStaged((prev) => [...prev, { id: crypto.randomUUID(), text }]);
  }

  function handleRemove(id: string) {
    setStaged((prev) => prev.filter((item) => item.id !== id));
  }

  function handleStart() {
    mutate(
      { texts: staged.map((item) => item.text), preset, instructions: instructions || undefined },
      { onSuccess: () => setStaged([]) },
    );
  }

  const stats: BatchStats = useMemo(() => {
    if (sources.length === 0) {
      return { sources: 0, extracted: 0, failed: 0, avgConfidence: null, totalCostUsd: 0, totalCostCny: 0 };
    }
    const allResults = sources.flatMap((s) => s.results);
    const extracted = allResults.filter((r) => r.status === 'success').length;
    const failed = allResults.filter((r) => r.status === 'failed').length;
    const confidences = allResults.filter((r) => r.status === 'success').map((r) => r.avgConfidence);
    return {
      sources: sources.length,
      extracted,
      failed,
      avgConfidence:
        confidences.length > 0
          ? confidences.reduce((sum, v) => sum + v, 0) / confidences.length
          : null,
      totalCostUsd: sources.reduce((sum, s) => sum + s.stats.totalCostUsd, 0),
      totalCostCny: sources.reduce((sum, s) => sum + s.stats.totalCostCny, 0),
    };
  }, [sources]);

  const counts: FilterCounts = useMemo(() => {
    const allResults = sources.flatMap((s) => s.results);
    const high = allResults.filter(
      (r) => r.status === 'success' && !needsReview({ avgConfidence: r.avgConfidence, confidence: r.confidence }),
    ).length;
    const review = allResults.filter(
      (r) => r.status === 'failed' || needsReview({ avgConfidence: r.avgConfidence, confidence: r.confidence }),
    ).length;
    return { all: allResults.length, high, review };
  }, [sources]);

  const visibleSources = useMemo(() => {
    if (filter === 'all') return sources;
    return sources
      .map((s) => ({
        ...s,
        results: s.results.filter((r) => {
          if (filter === 'high') {
            return (
              r.status === 'success' &&
              !needsReview({ avgConfidence: r.avgConfidence, confidence: r.confidence })
            );
          }
          return r.status === 'failed' || needsReview({ avgConfidence: r.avgConfidence, confidence: r.confidence });
        }),
      }))
      .filter((s) => s.results.length > 0);
  }, [sources, filter]);

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-[1080px] overflow-hidden rounded-card border border-border bg-surface">
        <Header />

        <section className="border-b border-border p-5">
          <PasteTextInput staged={staged} onAdd={handleAdd} onRemove={handleRemove} />
          <ConfigBar
            canStart={staged.length > 0}
            isLoading={isPending}
            onStart={handleStart}
          />
        </section>

        {error ? (
          <div className="mx-5 mt-4 rounded-card border border-error bg-error/10 px-3.5 py-2.5 text-caption text-error">
            {t('config.requestError', { message: error.message })}
          </div>
        ) : null}

        <section>
          <StatsStrip stats={stats} />
          <ResultsHeader counts={counts} />
          {sources.length === 0 ? (
            <EmptyState />
          ) : (
            visibleSources.map((source) => <SourceGroup key={source.id} source={source} />)
          )}
        </section>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  );
}
