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
import { useUiStore, savedSchemaLabel, SMART_PRESET_ID } from '@/store/uiStore';
import { quotaErrorCode, quotaI18nKey } from '@/utils/errors';
import {
  applyFieldEdit,
  buildAllowEmptyFields,
  buildReviewThresholds,
  reviewState,
} from '@/utils/review';
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
    presetOverrides,
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
  const updateResultField = useHistoryStore((s) => s.updateResultField);
  // Same cached query as ConfigBar: gives the preset's display name for the
  // history entry label snapshot.
  const { data: presets } = useQuery({ queryKey: ['presets'], queryFn: getPresets });
  // Same cached query as the SchemaEditor: gives fieldName -> displayName
  // for labeling result chips on the preset submit path. Skipped for
  // "smart" and saved schemas, which have no backend preset schema.
  const isSavedSchema = savedSchemas.some((s) => s.id === preset);
  // A locally-saved override of a backend preset must also submit as a
  // custom schema — the preset id alone would let the backend ignore edits.
  const hasPresetOverride =
    preset !== SMART_PRESET_ID && !isSavedSchema && presetOverrides[preset] !== undefined;
  const { data: presetFields } = usePresetSchema(preset, {
    enabled: preset !== SMART_PRESET_ID && !isSavedSchema,
  });

  /** Template display name at submit time: saved schema name, else the
   * backend preset's localized name — used for exports and history labels. */
  const templateName = (id: string): string => {
    const isZh = (i18n.resolvedLanguage ?? 'en').startsWith('zh');
    const saved = savedSchemas.find((s) => s.id === id);
    if (saved) return savedSchemaLabel(saved, isZh);
    return presets?.find((p) => p.id === id)?.[isZh ? 'display_name_zh' : 'display_name_en'] ?? id;
  };

  function handleAdd(name: string, text: string, fileUrl?: string) {
    setStaged((prev) => [...prev, { id: crypto.randomUUID(), name, text, fileUrl }]);
  }

  function handleRemove(id: string) {
    setStaged((prev) => prev.filter((item) => item.id !== id));
  }

  function handleRestoreHistory(entry: HistoryEntry) {
    setSources((prev) => [...withFreshIds(entry.sources), ...prev]);
    setHistoryOpen(false);
  }

  /** Review flow: apply an inline field correction to the on-screen state,
   * the open modal, and the persisted history entry (marks it reviewed and
   * snapshots the original extraction value for exports — issue #1). */
  function handleFieldUpdate(fieldKey: string, newValue: unknown) {
    if (!selected) return;
    const sourceId = selected.source.id;
    const applyEdit = (result: ExtractionResult): ExtractionResult =>
      applyFieldEdit(result, fieldKey, newValue);
    setSources((prev) =>
      prev.map((source) =>
        source.id !== sourceId
          ? source
          : { ...source, results: source.results.map(applyEdit) },
      ),
    );
    setSelected((prev) =>
      prev && prev.source.id === sourceId ? { ...prev, result: applyEdit(prev.result) } : prev,
    );
    updateResultField(sourceId, fieldKey, newValue);
  }

  async function handleStart() {
    setResolveError(null);

    let target: { schema: Record<string, unknown> } | { preset: string };
    let schemaResolveCost: { costUsd: number; costCny: number } | undefined;
    let fieldLabels: Record<string, string> | undefined;
    // Issue #2: field_name -> minimum confidence, snapshotted at submit so
    // review flags never re-evaluate against a later schema edit.
    let reviewThresholds: Record<string, number> | undefined;
    // Issue #2 allow-empty: keys of fields allowed to come back empty,
    // snapshotted with the same lifetime as the thresholds.
    let allowEmptyFields: string[] | undefined;
    // History label snapshot: the preset's display name in the UI language at
    // submit time (custom/smart schema batches get a fixed label instead).
    let presetLabel: string;

    if (preset === SMART_PRESET_ID) {
      setIsResolving(true);
      try {
        const inferred = await inferSchema(staged[0].text);
        // Field labels follow the UI language, not the input text's language.
        const isZh = (i18n.resolvedLanguage ?? 'en').startsWith('zh');
        const pickLabel = (
          spec: { display_name?: string | null; display_name_en?: string | null },
          fallback: string,
        ) =>
          (isZh ? spec.display_name || spec.display_name_en : spec.display_name_en || spec.display_name) ??
          fallback;
        // Same language rule as usePresetSchema: pick the description column
        // by UI language, falling back to the other one.
        const pickDescription = (spec: { description?: string | null; description_en?: string | null }) =>
          (isZh ? spec.description || spec.description_en : spec.description_en || spec.description) ?? '';
        const fields: SchemaField[] = Object.entries(inferred.schema.fields).map(
          ([fieldName, spec]) => ({
            displayName: pickLabel(spec, fieldName),
            displayNameEn: spec.display_name_en ?? spec.display_name ?? null,
            fieldName,
            type: spec.type as SchemaField['type'],
            description: pickDescription(spec),
          }),
        );
        // Name the saved template after the AI's own bilingual names so the
        // dropdown can follow later language switches; the timestamp prefix
        // remains a fallback for older backends.
        const nonEmpty = (n: string | null | undefined): n is string =>
          typeof n === 'string' && n.length > 0;
        const zhName = [inferred.schema_name, inferred.schema_name_en].find(nonEmpty);
        const enName = [inferred.schema_name_en, inferred.schema_name].find(nonEmpty);
        const stamp = new Date().toLocaleString(i18n.resolvedLanguage ?? 'en', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
        const fallbackName = `${t('config.smartSavedNamePrefix')} ${stamp}`;
        const newId = addSavedSchema(zhName ?? fallbackName, enName ?? fallbackName, fields);
        // Exports/history label: the template's name in the UI language.
        presetLabel = (isZh ? zhName : enName) ?? fallbackName;
        // Switch the dropdown to the newly saved schema (D-F06); setPreset
        // clears customFields, so setCustomFields must run after it.
        setPreset(newId);
        setCustomFields(fields);
        target = { schema: inferred.schema };
        schemaResolveCost = { costUsd: inferred.cost_usd, costCny: inferred.cost_cny };
        fieldLabels = Object.fromEntries(
          Object.entries(inferred.schema.fields).map(([name, spec]) => [
            name,
            pickLabel(spec, name),
          ]),
        );
      } catch (err) {
        setResolveError(err instanceof Error ? err.message : String(err));
        return;
      } finally {
        setIsResolving(false);
      }
    } else if (isSchemaModified || isSavedSchema || hasPresetOverride) {
      // Persist edits made to an already-saved schema before submitting.
      if (isSavedSchema && isSchemaModified) updateSavedSchema(preset, customFields);

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
        // Issue #2: the backend owns the keys after resolve, so re-key the
        // configured thresholds through the resolved schema.
        reviewThresholds = buildReviewThresholds(customFields, resolved.schema.fields);
        allowEmptyFields = buildAllowEmptyFields(customFields, resolved.schema.fields);
      } catch (err) {
        setResolveError(err instanceof Error ? err.message : String(err));
        return;
      } finally {
        setIsResolving(false);
      }
      // Exports/history label: the saved schema's own name, or the display
      // name of the backend preset the user edited.
      presetLabel = templateName(preset);
    } else {
      target = { preset };
      fieldLabels = presetFields
        ? Object.fromEntries(
            presetFields
              .filter((f) => f.fieldName)
              .map((f) => [f.fieldName as string, f.displayName]),
          )
        : undefined;
      // Plain preset path: keys are already the backend's field names. Only
      // reachable with configured thresholds if a saved override exists (in
      // which case the custom path above runs instead), so this is normally
      // empty — kept for safety if that routing ever changes.
      reviewThresholds = buildReviewThresholds(customFields);
      allowEmptyFields = buildAllowEmptyFields(customFields);
      presetLabel = templateName(preset);
    }

    mutate(
      {
        texts: staged.map((item) => item.text),
        // Blob urls of the original uploads, aligned with texts by index;
        // only pdf/image sources have one (PasteTextInput creates it there).
        fileUrls: staged.map((item) => item.fileUrl),
        ...target,
        instructions: instructions || undefined,
        // UI language: preset field descriptions sent to the LLM follow it.
        lang: i18n.resolvedLanguage ?? undefined,
        schemaResolveCost,
        fieldLabels,
        presetLabel,
        reviewThresholds,
        allowEmptyFields,
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

  // Demo-stage quota guard (D-019): a 429 gets a localized friendly message
  // instead of the raw error body.
  const quotaCode = quotaErrorCode(error);
  const requestErrorMessage = quotaCode
    ? t(quotaI18nKey(quotaCode))
    : resolveError ?? error?.message;

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
    let high = 0;
    let review = 0;
    let reviewed = 0;
    let all = 0;
    for (const source of sources) {
      for (const result of source.results) {
        all += 1;
        // Issue #3: judge each result against its own source's snapshot via
        // the shared three-state helper; none→high, reviewed→reviewed,
        // pending (incl. failed)→review.
        const state = reviewState(result, source);
        if (state === 'none') high += 1;
        else if (state === 'reviewed') reviewed += 1;
        else review += 1;
      }
    }
    return { all, high, review, reviewed };
  }, [sources]);

  const visibleSources = useMemo(() => {
    if (filter === 'all') return sources;
    return sources
      .map((s) => ({
        ...s,
        results: s.results.filter((r) => {
          const state = reviewState(r, s);
          if (filter === 'high') return state === 'none';
          if (filter === 'reviewed') return state === 'reviewed';
          return state === 'pending';
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
            {quotaCode
              ? requestErrorMessage
              : t('config.requestError', { message: requestErrorMessage })}
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
          onFieldUpdate={handleFieldUpdate}
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
