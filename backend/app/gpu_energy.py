"""Best-effort NVIDIA device telemetry for a local inference call window.

Readings describe the whole selected device, not a process or user. They include
idle/other workloads and exclude CPU, memory, and system energy.
"""
import asyncio
import csv
import math
import shutil
from dataclasses import dataclass
from time import monotonic


SAMPLE_INTERVAL_MS = 100
MAX_EDGE_GAP_SECONDS = 0.35


@dataclass(frozen=True)
class GpuMeasurement:
    gpu_index: int
    gpu_name: str
    energy_wh: float | None
    average_power_w: float | None
    utilization_pct: float | None
    sample_count: int


class NvidiaGpuPowerSampler:
    def __init__(self, process):
        self.process = process
        self.samples: list[tuple[float, int, str, float, float | None]] = []
        self.reader: asyncio.Task | None = None
        self.first_sample = asyncio.Event()

    @classmethod
    async def start(cls):
        executable = shutil.which('nvidia-smi')
        if executable is None:
            return None
        try:
            process = await asyncio.create_subprocess_exec(
                executable,
                '--query-gpu=index,name,power.draw,utilization.gpu',
                '--format=csv,noheader,nounits', '--id=0', f'--loop-ms={SAMPLE_INTERVAL_MS}',
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            )
        except (OSError, NotImplementedError):
            return None
        sampler = cls(process)
        sampler.reader = asyncio.create_task(sampler._read())
        try:
            await asyncio.wait_for(sampler.first_sample.wait(), timeout=1.5)
        except (TimeoutError, asyncio.TimeoutError):
            await sampler.close()
            return None
        return sampler

    async def _read(self):
        if self.process.stdout is None:
            return
        while line := await self.process.stdout.readline():
            try:
                row = next(csv.reader([line.decode('utf-8').strip()]))
                index = int(row[0].strip())
                name = row[1].strip()
                watts = float(row[2].strip())
                utilization = _optional_percent(row[3]) if len(row) > 3 else None
            except (UnicodeDecodeError, ValueError, IndexError, csv.Error):
                continue
            if index == 0 and name and math.isfinite(watts) and watts >= 0:
                self.samples.append((monotonic(), index, name[:200], watts, utilization))
                self.first_sample.set()

    async def close(self):
        if self.process.returncode is None:
            try:
                self.process.terminate()
            except ProcessLookupError:
                pass
        try:
            await asyncio.wait_for(self.process.wait(), timeout=1)
        except (TimeoutError, asyncio.TimeoutError):
            self.process.kill()
            await self.process.wait()
        if self.reader is not None:
            try:
                await asyncio.wait_for(self.reader, timeout=0.25)
            except (TimeoutError, asyncio.TimeoutError):
                self.reader.cancel()
                await asyncio.gather(self.reader, return_exceptions=True)

    async def measure(self, start: float, end: float) -> GpuMeasurement | None:
        """Integrate readings when samples closely bracket the call window."""
        await self.close()
        if end <= start or not self.samples:
            return None
        samples = [sample for sample in self.samples if sample[0] <= end]
        if not samples:
            return None
        window_samples = [sample for sample in samples if start <= sample[0] <= end]
        power_samples = [(timestamp, watts) for timestamp, _, _, watts, _ in samples]
        energy = None
        average_power = None
        if len(samples) >= 2:
            left_gap, right_gap = start - samples[0][0], end - samples[-1][0]
            if (0 <= left_gap <= MAX_EDGE_GAP_SECONDS and 0 <= right_gap <= MAX_EDGE_GAP_SECONDS):
                points = [(start, _interpolate(power_samples, start))]
                points.extend((timestamp, watts) for timestamp, watts in power_samples if start < timestamp < end)
                points.append((end, _interpolate(power_samples, end)))
                joules = sum((t1 - t0) * (p0 + p1) / 2
                             for (t0, p0), (t1, p1) in zip(points, points[1:]))
                energy = joules / 3600 if math.isfinite(joules) and joules >= 0 else None
                average_power = joules / (end - start) if energy is not None else None
        if average_power is None and window_samples:
            average_power = sum(sample[3] for sample in window_samples) / len(window_samples)
        utilization_samples = [(timestamp, value) for timestamp, _, _, _, value in window_samples
                               if value is not None]
        utilization = (sum(value for _, value in utilization_samples) / len(utilization_samples)
                       if utilization_samples else None)
        _, index, name, _, _ = samples[-1]
        return GpuMeasurement(index, name, energy, average_power, utilization, len(window_samples))


def _optional_percent(raw: str) -> float | None:
    try:
        value = float(raw.strip())
    except ValueError:
        return None
    return value if math.isfinite(value) and 0 <= value <= 100 else None


def _interpolate(samples: list[tuple[float, float]], at: float) -> float:
    before = samples[0]
    for after in samples[1:]:
        if before[0] <= at <= after[0]:
            span = after[0] - before[0]
            return after[1] if span <= 0 else before[1] + (after[1] - before[1]) * ((at - before[0]) / span)
        before = after
    return samples[0][1] if at < samples[0][0] else samples[-1][1]
