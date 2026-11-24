export function PeriodArrows({ label, onMove }: { label: string; onMove: (delta: number) => void }) {
  return <div className="period-arrows">
    <button type="button" aria-label={`이전 ${label}`} onClick={() => onMove(-1)}>‹</button>
    <button type="button" aria-label={`다음 ${label}`} onClick={() => onMove(1)}>›</button>
  </div>;
}
