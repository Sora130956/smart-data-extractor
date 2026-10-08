import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Header } from '@/components/layout/Header';
import { StatsStrip, type BatchStats } from '@/components/layout/StatsStrip';
import { PasteTextInput, type StagedText } from '@/components/input/PasteTextInput';
import { ConfigBar } from '@/components/input/ConfigBar';
import { ResultsHeader, type FilterCounts } from '@/components/results/ResultsHeader';
import { EmptyState } from '@/components/results/EmptyState';
import { SourceGroup } from '@/components/results/SourceGroup';
import { ResultDetailModal } from '@/components/results/ResultDetailModal';
import { HistoryPanel } from '@/components/history/HistoryPanel';
import { getPresets, inferSchema, resolveSchema, type SchemaResolveFieldParams } from '@/api/client';
import { useBatchExtract } from '@/hooks/useBatchExtract';
import { usePresetSchema } from '@/hooks/usePresetSchema';
import { useHistoryStore, type HistoryEntry } from '@/store/historyStore';
import { useUiStore, SMART_PRESET_ID } from '@/store/uiStore';
import { needsReview } from '@/utils/confidence';
import type { ExtractionResult, ExtractionSource, SchemaField } from '@/types/extraction';

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

/** Restored history batches may collide with sources already on screen (same
 * ids), so they get a fresh unique suffix before being prepended. */
function withFreshIds(sources: ExtractionSource[]): ExtractionSource[] {
  const suffix = crypto.randomUUID().slice(0, 8);
  return sources.map((s) => {
    const id = `${s.id}~${suffix}`;
    return { ...s, id, results: s.results.map((r) => ({ ...r, sourceId: id })) };
  });
}

function AppShell() {
  const { t, i18n } = useTranslation();
  const {
    preset,
    instructions,
    filter,
    customFields,
    isSchemaModified,
    savedSchemas,
    setPreset,
    setCustomFields,
    addSavedSchema,
    updateSavedSchema,
  } = useUiStore();
  const [staged, setStaged] = useState<StagedText[]>([]);
  const [isResolving, setIsResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{
    source: ExtractionSource;
    result: ExtractionResult;
    resultIndex: number;
  } | null>(null);
  const { mutate, isPending, error } = useBatchExtract();
  // Extraction results accumulate across batches (newest first). The mutation's
  // own `data` only holds the latest batch, so it is merged into this state.
  const [sources, setSources] = useState<ExtractionSource[]>([]);
  const [isHistoryOpen, setHistoryOpen] = useState(false);
  const addHistoryEntry = useHistoryStore((s) => s.addEntry);
  // Same cached query as ConfigBar: gives the preset's display name for the
  // history entry label snapshot.
  const { data: presets } = useQuery({ queryKey: ['presets'], queryFn: getPresets });
  // Same cached query as the SchemaEditor: gives fieldName -> displayName
  // for labeling result chips on the preset submit path. Skipped for
  // "smart" and saved schemas, which have no backend preset schema.
  const isSavedSchema = savedSchemas.some((s) => s.id === preset);
  const { data: presetFields } = usePresetSchema(preset, {
    enabled: preset !== SMART_PRESET_ID && !isSavedSchema,
  });

  function handleAdd(name: string, text: string) {
    setStaged((prev) => [...prev, { id: crypto.randomUUID(), name, text }]);
  }

  function handleRemove(id: string) {
    setStaged((prev) => prev.filter((item) => item.id !== id));
  }

  function handleRestoreHistory(entry: HistoryEntry) {
    setSources((prev) => [...withFreshIds(entry.sources), ...prev]);
    setHistoryOpen(false);
  }

  async function handleStart() {
    setResolveError(null);

    let target: { schema: Record<string, unknown> } | { preset: string };
    let schemaResolveCost: { costUsd: number; costCny: number } | undefined;
    let fieldLabels: Record<string, string> | undefined;
    // History label snapshot: the preset's display name in the UI language at
    // submit time (custom/smart schema batches get a fixed label instead).
    let presetLabel: string;

    if (preset === SMART_PRESET_ID) {
      setIsResolving(true);
      try {
        const inferred = await inferSchema(staged[0].text);
        const fields: SchemaField[] = Object.entries(inferred.schema.fields).map(
          ([fieldName, spec]) => ({
            displayName: spec.display_name ?? fieldName,
            fieldName,
            type: spec.type as SchemaField['type'],
            description: spec.description ?? '',
          }),
        );
        const stamp = new Date().toLocaleString(i18n.resolvedLanguage ?? 'en', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
        const newId = addSavedSchema(`${t('config.smartSavedNamePrefix')} ${stamp}`, fields);
        // Switch the dropdown to the newly saved schema (D-F06); setPreset
        // clears customFields, so setCustomFields must run after it.
        setPreset(newId);
        setCustomFields(fields);
        target = { schema: inferred.schema };
        schemaResolveCost = { costUsd: inferred.cost_usd, costCny: inferred.cost_cny };
        fieldLabels = Object.fromEntries(
          Object.entries(inferred.schema.fields)
            .filter(([, spec]) => spec.display_name)
            .map(([name, spec]) => [name, spec.display_name as string]),
        );
      } catch (err) {
        setResolveError(err instanceof Error ? err.message : String(err));
        return;
      } finally {
        setIsResolving(false);
      }
      presetLabel = t('history.customSchema');
    } else if (isSchemaModified) {
      // Persist edits made to an already-saved schema before submitting.
      if (isSavedSchema) updateSavedSchema(preset, customFields);

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
        // The resolved schema echoes each field's display name; snapshot it
        // so chips keep their labels even for freshly generated field names.
        fieldLabels = Object.fromEntries(
          Object.entries(resolved.schema.fields)
            .filter(([, spec]) => spec.display_name)
            .map(([name, spec]) => [name, spec.display_name as string]),
        );
      } catch (err) {
        setResolveError(err instanceof Error ? err.message : String(err));
        return;
      } finally {
        setIsResolving(false);
      }
      presetLabel = t('history.customSchema');
    } else {
      target = { preset };
      fieldLabels = presetFields
        ? Object.fromEntries(
            presetFields
              .filter((f) => f.fieldName)
              .map((f) => [f.fieldName as string, f.displayName]),
          )
        : undefined;
      const isZh = (i18n.resolvedLanguage ?? 'en').startsWith('zh');
      presetLabel =
        presets?.find((p) => p.id === preset)?.[isZh ? 'display_name_zh' : 'display_name_en'] ??
        preset;
    }

    mutate(
      {
        texts: staged.map((item) => item.text),
        ...target,
        instructions: instructions || undefined,
        // UI language: preset field descriptions sent to the LLM follow it.
        lang: i18n.resolvedLanguage ?? undefined,
        schemaResolveCost,
        fieldLabels,
      },
      {
        onSuccess: (newSources) => {
          setSources((prev) => [...newSources, ...prev]);
          addHistoryEntry(newSources, presetLabel);
          setStaged([]);
        },
      },
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
        <Header onOpenHistory={() => setHistoryOpen(true)} />

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
          <ResultsHeader counts={counts} sources={sources} />
          {sources.length === 0 ? (
            <EmptyState />
          ) : (
            visibleSources.map((source) => (
              <SourceGroup
                key={source.id}
                source={source}
                onView={(result, resultIndex) => setSelected({ source, result, resultIndex })}
              />
            ))
          )}
        </section>
      </div>

      {selected ? (
        <ResultDetailModal
          source={selected.source}
          result={selected.result}
          label={t('paste.itemLabel', { index: selected.resultIndex + 1 })}
          onClose={() => setSelected(null)}
        />
      ) : null}

      {isHistoryOpen ? (
        <HistoryPanel
          onClose={() => setHistoryOpen(false)}
          onRestore={handleRestoreHistory}
        />
      ) : null}
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
