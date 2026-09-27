import { Header } from '@/components/layout/Header';
import { StatsStrip } from '@/components/layout/StatsStrip';
import { UploadZone } from '@/components/input/UploadZone';
import { ConfigBar } from '@/components/input/ConfigBar';
import { ResultsHeader } from '@/components/results/ResultsHeader';
import { EmptyState } from '@/components/results/EmptyState';

export default function App() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-[1080px] overflow-hidden rounded-card border border-border bg-surface">
        <Header />
        <StatsStrip />

        <section className="border-b border-border p-5">
          <UploadZone />
          <ConfigBar />
        </section>

        <section>
          <ResultsHeader />
          <EmptyState />
        </section>
      </div>
    </div>
  );
}
