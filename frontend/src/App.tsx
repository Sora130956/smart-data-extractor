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
import { resolveSchema, type SchemaResolveFieldParams } from '@/api/client';
import { useBatchExtract } from '@/hooks/useBatchExtract';
import { useUiStore } from '@/store/uiStore';
import { needsReview } from '@/utils/confidence';
import type { SchemaField } from '@/types/extraction';

const queryClient = new QueryClient();

/** §5.3: a field needs /schema/resolve when its name is unknown, or when a
 * preset field's display name/description has diverged from its baseline. */
function needsResolve(field: SchemaField): boolean {
  return (
    field.fieldName === null ||
    (field.originalDisplayName !== undefined &&
      (field.displayName !== field.originalDisplayName ||
        field.description !== field.originalDescription))
  );
}

function AppShell() {
  const { t, i18n } = useTranslation();
  const { preset, instructions, filter, customFields, isSchemaModified } = useUiStore();
  const [staged, setStaged] = useState<StagedText[]>([]);
  const [isResolving, setIsResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const { mutate, data: sources = [], isPending, error } = useBatchExtract();

  function handleAdd(name: string, text: string) {
    setStaged((prev) => [...prev, { id: crypto.randomUUID(), name, text }]);
  }

  function handleRemove(id: string) {
    setStaged((prev) => prev.filter((item) => item.id !== id));
  }

  async function handleStart() {
    setResolveError(null);

    let target: { schema: Record<string, unknown> } | { preset: string };
    let schemaResolveCost: { costUsd: number; costCny: number } | undefined;

    if (isSchemaModified) {
      const fields: SchemaResolveFieldParams[] = customFields.map((f) => {
        const field: SchemaResolveFieldParams = {
          display_name: f.displayName,
          description: f.description,
          type: f.type,
        };
        if (!needsResolve(f) && f.fieldName) field.field_name = f.fieldName;
        return field;
      });

      setIsResolving(true);
      try {
        const resolved = await resolveSchema(fields);
        target = { schema: resolved.schema };
        schemaResolveCost = { costUsd: resolved.cost_usd, costCny: resolved.cost_cny };
      } catch (err) {
        setResolveError(err instanceof Error ? err.message : String(err));
        return;
      } finally {
        setIsResolving(false);
      }
    } else {
      target = { preset };
    }

    mutate(
      {
        texts: staged.map((item) => item.text),
        ...target,
        instructions: instructions || undefined,
        // UI language: preset field descriptions sent to the LLM follow it.
        lang: i18n.resolvedLanguage ?? undefined,
        schemaResolveCost,
      },
      { onSuccess: () => setStaged([]) },
    );
  }

  const requestErrorMessage = resolveError ?? error?.message;

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
      totalCostUsd: sources.reduce((sum, s) => sum + s.stats.totalCostUsd + s.stats.schemaResolveCostUsd, 0),
      totalCostCny: sources.reduce((sum, s) => sum + s.stats.totalCostCny + s.stats.schemaResolveCostCny, 0),
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
            isLoading={isPending || isResolving}
            onStart={handleStart}
          />
        </section>

        {requestErrorMessage ? (
          <div className="mx-5 mt-4 rounded-card border border-error bg-error/10 px-3.5 py-2.5 text-caption text-error">
            {t('config.requestError', { message: requestErrorMessage })}
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
