import { useEffect, useMemo, useState } from 'react';
import type { Result, Run } from './api/types';
import './eco-impact.css';

type LedgerEntry = {
  runId: string;
  completedAt: string;
  measurementSource: Run['measurement_source'];
  mode: Run['mode'];
  taskCount: number;
  energyPairs: number;
  energySavedWh: number | null;
  carbonSavedG: number | null;
  carbonIntensity: number;
};

const LEDGER_KEY = 'ecoagent.impact-ledger.v1';
const TARGET_KEY = 'ecoagent.impact-target-g.v1';
const missing = 'Unavailable';
const terminal = (status: Run['status']) => ['completed', 'partial', 'failed'].includes(status);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function finiteOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isLedgerEntry(value: unknown): value is LedgerEntry {
  if (!isRecord(value)) return false;
  return typeof value.runId === 'string'
    && typeof value.completedAt === 'string'
    && Number.isFinite(Date.parse(value.completedAt))
    && (value.measurementSource === 'simulated' || value.measurementSource === 'provider_usage_and_client_timing')
    && (value.mode === 'demo' || value.mode === 'live')
    && typeof value.taskCount === 'number' && Number.isInteger(value.taskCount) && value.taskCount >= 0
    && typeof value.energyPairs === 'number' && Number.isInteger(value.energyPairs) && value.energyPairs >= 0
    && finiteOrNull(value.energySavedWh)
    && finiteOrNull(value.carbonSavedG)
    && typeof value.carbonIntensity === 'number' && Number.isFinite(value.carbonIntensity);
}

function readLedger(): LedgerEntry[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(LEDGER_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(isLedgerEntry).slice(0, 50) : [];
  } catch {
    return [];
  }
}

function format(value: number | null, digits = 6): string {
  if (value === null) return missing;
  const absolute = Math.abs(value);
  const rendered = absolute > 0 && absolute < 10 ** -digits
    ? `<${(10 ** -digits).toFixed(digits)}`
    : absolute.toFixed(digits);
  return value < 0 ? `−${rendered}` : rendered;
}

function describeSaved(value: number | null, unit: string): string {
  if (value === null) return missing;
  if (value > 0) return `${format(value)} ${unit} estimated decrease`;
  if (value < 0) return `${format(value)} ${unit} estimated increase`;
  return `No estimated ${unit} change`;
}

function resultFor(run: Run, taskId: string, policy: Result['policy']): Result | undefined {
  return run.results.find((result) => result.task_id === taskId && result.policy === policy);
}

function impactDelta(baseline: Result | undefined, optimized: Result | undefined): number | null {
  if (baseline?.status !== 'succeeded' || optimized?.status !== 'succeeded'
    || baseline.estimated_energy_wh === null || optimized.estimated_energy_wh === null) return null;
  return baseline.estimated_energy_wh - optimized.estimated_energy_wh;
}

function sourceLabel(source: Run['measurement_source']): string {
  return source === 'simulated' ? 'SIMULATED' : 'OBSERVED';
}

export default function EcoImpactPanel({ run }: { run: Run }) {
  const [entries, setEntries] = useState<LedgerEntry[]>(readLedger);
  const [storageAvailable, setStorageAvailable] = useState(() => {
    try {
      window.localStorage.getItem(LEDGER_KEY);
      window.localStorage.getItem(TARGET_KEY);
      return true;
    } catch {
      return false;
    }
  });
  const [scenarioIntensity, setScenarioIntensity] = useState(run.carbon_intensity_g_per_kwh);
  const [carbonTarget, setCarbonTarget] = useState(() => {
    try {
      return window.localStorage.getItem(TARGET_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [suppressedRunId, setSuppressedRunId] = useState<string | null>(null);

  useEffect(() => {
    setScenarioIntensity(run.carbon_intensity_g_per_kwh);
    setSuppressedRunId(null);
  }, [run.id, run.carbon_intensity_g_per_kwh]);

  useEffect(() => {
    if (!terminal(run.status) || run.comparison.energy_pairs < 1 || suppressedRunId === run.id) return;
    const entry: LedgerEntry = {
      runId: run.id,
      completedAt: run.finished_at ?? run.created_at,
      measurementSource: run.measurement_source,
      mode: run.mode,
      taskCount: run.tasks.length,
      energyPairs: run.comparison.energy_pairs,
      energySavedWh: run.comparison.energy_wh.saved,
      carbonSavedG: run.comparison.carbon_g.saved,
      carbonIntensity: run.carbon_intensity_g_per_kwh,
    };
    if (entries.some((existing) => existing.runId === entry.runId)) return;
    const next = [entry, ...entries].slice(0, 50);
    setEntries(next);
    try {
      window.localStorage.setItem(LEDGER_KEY, JSON.stringify(next));
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
  }, [entries, run, suppressedRunId]);

  const taskRows = useMemo(() => run.tasks.map((task) => {
    const baseline = resultFor(run, task.id, 'baseline');
    const optimized = resultFor(run, task.id, 'optimized');
    return { task, optimized, deltaWh: impactDelta(baseline, optimized) };
  }), [run]);
  const taskCounts = useMemo(() => taskRows.reduce((counts, row) => {
    if (row.deltaWh === null) counts.unavailable += 1;
    else if (row.deltaWh > 0) counts.decrease += 1;
    else if (row.deltaWh < 0) counts.increase += 1;
    else counts.same += 1;
    return counts;
  }, { decrease: 0, increase: 0, same: 0, unavailable: 0 }), [taskRows]);

  const scenarioCarbonSaved = run.comparison.energy_wh.saved === null
    ? null
    : run.comparison.energy_wh.saved * scenarioIntensity / 1000;
  const parsedTarget = carbonTarget.trim() === '' ? null : Number(carbonTarget);
  const targetNumber = parsedTarget !== null && Number.isFinite(parsedTarget) && parsedTarget >= 0 ? parsedTarget : null;
  const optimizedCarbon = run.comparison.carbon_g.optimized;
  const targetMessage = carbonTarget.trim() !== '' && targetNumber === null
    ? 'Enter a valid nonnegative target.'
    : targetNumber === null
    ? 'Optional target. This browser stores only the target number.'
    : optimizedCarbon === null
      ? `${missing}: no complete energy cohort is available for this comparison.`
      : `${run.status === 'completed' ? 'Current run' : 'Provisional run'} is ${optimizedCarbon <= targetNumber ? 'within' : 'above'} your target, using its selected carbon scenario.`;

  const updateTarget = (value: string) => {
    setCarbonTarget(value);
    try {
      if (value.trim() === '') window.localStorage.removeItem(TARGET_KEY);
      else if (Number.isFinite(Number(value)) && Number(value) >= 0) window.localStorage.setItem(TARGET_KEY, value);
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
  };

  const clearLedger = () => {
    setEntries([]);
    setSuppressedRunId(run.id);
    try {
      window.localStorage.removeItem(LEDGER_KEY);
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
  };

  const grouped = (source: Run['measurement_source']) => {
    const selected = entries.filter((entry) => entry.measurementSource === source);
    const knownEnergy = selected.map((entry) => entry.energySavedWh).filter((value): value is number => value !== null);
    const knownCarbon = selected.map((entry) => entry.carbonSavedG).filter((value): value is number => value !== null);
    return {
      count: selected.length,
      energy: knownEnergy.length ? knownEnergy.reduce((sum, value) => sum + value, 0) : null,
      energyRuns: knownEnergy.length,
      carbon: knownCarbon.length ? knownCarbon.reduce((sum, value) => sum + value, 0) : null,
      carbonRuns: knownCarbon.length,
    };
  };

  const simulated = grouped('simulated');
  const observed = grouped('provider_usage_and_client_timing');
  const provenance = sourceLabel(run.measurement_source);

  return <section className="eco-impact panel" aria-labelledby="eco-impact-title">
    <div className="eco-impact-heading">
      <div><span className="section-kicker">ECOSYSTEM / IMPACT TOOLS</span><h3 id="eco-impact-title">Understand the footprint</h3><p>Explore the backend’s estimates, how routing changes task impact, and what assumptions shape the result.</p></div>
      <span className={`provenance-pill ${run.measurement_source === 'simulated' ? 'simulated' : 'observed'}`}><span />{provenance} RUN</span>
    </div>

    <section className="eco-subsection" aria-labelledby="eco-task-map-title">
      <div className="eco-subheading"><div><span className="section-kicker">01 / PER TASK</span><h4 id="eco-task-map-title">Routing footprint map</h4></div><p>Backend-selected optimized route · estimated energy only</p></div>
      <p className="eco-count-summary" aria-live="polite">{taskCounts.decrease} task estimates decreased · {taskCounts.increase} increased · {taskCounts.same} unchanged · {taskCounts.unavailable} unavailable or pending.</p>
      <div className="eco-task-list">
        {taskRows.map(({ task, optimized, deltaWh }) => {
          const impactClass = deltaWh === null ? 'unknown' : deltaWh > 0 ? 'decrease' : deltaWh < 0 ? 'increase' : 'same';
          const impactLabel = deltaWh === null ? missing : deltaWh > 0 ? 'Estimated decrease' : deltaWh < 0 ? 'Estimated increase' : 'No estimated change';
          return <article className="eco-task-row" key={task.id}>
            <div className="eco-task-identity"><strong>{task.id}</strong><span>{task.type}</span></div>
            <div className="eco-task-route"><span>Backend route</span><strong>{optimized?.model_id ?? 'Pending'}</strong><small>{optimized?.routing_reason ?? 'Route reason unavailable'}</small></div>
            <div className={`eco-task-delta ${impactClass}`}><span>{impactLabel}</span><strong>{deltaWh === null ? missing : `${format(Math.abs(deltaWh))} Wh`}</strong></div>
          </article>;
        })}
      </div>
      <p className="eco-disclaimer">A lower estimate is not proof of equal answer quality or measured electricity. Review paired answers before adopting a route.</p>
    </section>

    <div className="eco-tool-grid">
      <section className="eco-tool" aria-labelledby="eco-scenario-title">
        <span className="section-kicker">02 / SCENARIO</span><h4 id="eco-scenario-title">Carbon-intensity explorer</h4>
        <p>See how this run’s estimated energy difference changes under a different carbon-intensity assumption.</p>
        <label className="eco-range-label" htmlFor="eco-intensity-range">Scenario intensity <output htmlFor="eco-intensity-range">{scenarioIntensity.toLocaleString()} gCO₂e/kWh</output></label>
        <input id="eco-intensity-range" className="eco-range" type="range" min="0" max="2000" step="10" value={scenarioIntensity} onChange={(event) => setScenarioIntensity(Number(event.target.value))} aria-valuetext={`${scenarioIntensity} grams CO2 equivalent per kilowatt-hour`} />
        <p className="eco-scenario-result" role="status" aria-live="polite">At this scenario intensity: {describeSaved(scenarioCarbonSaved, 'gCO₂e')}.</p>
        <small>Formula: saved Wh × scenario intensity ÷ 1,000. What-if only. The run remains at {run.carbon_intensity_g_per_kwh.toLocaleString()} gCO₂e/kWh; this is not live grid data and does not change backend results.</small>
      </section>

      <section className="eco-tool" aria-labelledby="eco-target-title">
        <span className="section-kicker">03 / PERSONAL TARGET</span><h4 id="eco-target-title">Set an estimated carbon target</h4>
        <p>Compare the optimized result with a target you choose for one workload.</p>
        <label className="eco-target-label" htmlFor="eco-carbon-target">Target per run (gCO₂e)</label>
        <input id="eco-carbon-target" className="eco-target-input" type="number" min="0" step="0.000001" value={carbonTarget} onChange={(event) => updateTarget(event.target.value)} placeholder="For example, 0.02" />
        <p className="eco-target-result" role="status" aria-live="polite">{targetMessage}</p>
        <small>This target is local to this browser and is not enforced by the backend. {storageAvailable ? 'No prompts, answers, or keys are saved here.' : 'Browser storage is unavailable; this setting may not persist.'}</small>
      </section>
    </div>

    <section className="eco-subsection eco-ledger" aria-labelledby="eco-ledger-title">
      <div className="eco-subheading"><div><span className="section-kicker">04 / THIS BROWSER</span><h4 id="eco-ledger-title">Impact ledger</h4></div><button type="button" className="text-button" onClick={clearLedger} disabled={!entries.length}>Clear local ledger</button></div>
      <p>Tracks terminal comparisons with complete usage pairs on this device. Demo and observed runs are kept separate; only summary metrics are stored.</p>
      <div className="eco-ledger-grid">
        {([{ label: 'SIMULATED', data: simulated }, { label: 'OBSERVED', data: observed }] as const).map(({ label, data }) => <article className="eco-ledger-card" key={label}>
          <div><span className={`provenance-pill ${label === 'SIMULATED' ? 'simulated' : 'observed'}`}><span />{label}</span><span>{data.count} saved run{data.count === 1 ? '' : 's'}</span></div>
          <p><strong>{data.count ? describeSaved(data.energy, 'Wh') : 'No recorded runs'}</strong><span>Estimated energy difference · {data.energyRuns} runs with values</span></p>
          <p><strong>{data.count ? describeSaved(data.carbon, 'gCO₂e') : 'No recorded runs'}</strong><span>Sum of each run’s selected scenario · {data.carbonRuns} runs with values</span></p>
        </article>)}
      </div>
      {entries.length > 0 && <ol className="eco-ledger-history" aria-label="Recent local impact records">{entries.slice(0, 5).map((entry) => <li key={entry.runId}>
        <div><span className={`provenance-pill ${entry.measurementSource === 'simulated' ? 'simulated' : 'observed'}`}><span />{sourceLabel(entry.measurementSource)}</span><strong>{entry.mode.toUpperCase()} · run {entry.runId.slice(0, 8)}</strong><time dateTime={entry.completedAt}>{new Date(entry.completedAt).toLocaleString()}</time></div>
        <p>{describeSaved(entry.energySavedWh, 'Wh')} · {describeSaved(entry.carbonSavedG, 'gCO₂e')} at {entry.carbonIntensity.toLocaleString()} gCO₂e/kWh · {entry.energyPairs} complete usage pairs</p>
      </li>)}</ol>}
      <small>Stored in local browser storage only (up to 50 run summaries). Carbon totals combine the scenarios selected for those runs; they are not measured emissions or organization-wide reporting.{!storageAvailable && ' Storage is currently unavailable.'}</small>
    </section>
  </section>;
}
