import "source-map-support";

import {
    Clock,
    Counter,
    Gauge,
    Histogram,
    Meter,
    Metric,
    MetricRegistry,
    MetricReporter,
    MILLISECOND,
    MINUTE,
    MonotoneCounter,
    StdClock,
    Taggable,
    Timer,
} from "inspector-metrics";

interface MetricEntry {
    lastReport: number;
    lastValue: number;
}

type MetricType = "counter" | "gauge" | "histogram" | "summary" | "untyped";

export class Buckets {

    public static linear(start: number, bucketWidth: number, count: number) {
        const buckets = new Buckets();
        buckets.boundaries = new Array(count);
        for (let i = 0; i < count; i++) {
            buckets.boundaries[i] = start;
            start += bucketWidth;
        }
        return buckets;
    }

    public static exponential(initial: number, factor: number, count: number) {
        const buckets = new Buckets();
        buckets.boundaries = new Array(count);
        for (let i = 0; i < count; i++) {
            buckets.boundaries[i] = initial;
            initial *= factor;
        }
        return buckets;
    }

    constructor(
        public boundaries: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    ) {}

}

export class Percentiles {

    constructor(
        public boundaries: number[] = [0.01, 0.05, 0.5, 0.75, 0.9, 0.95, 0.98, 0.99, 0.999],
    ) {}

}

export class Options {
    constructor(
        public includeTimestamp: boolean = false,
        public emitComments: boolean = true,
        public useUntyped: boolean = false,
    ) {}
}

/**
 * Metric reporter for prometheus.
 *
 * @see https://prometheus.io/docs/concepts/
 * @see https://prometheus.io/docs/instrumenting/exposition_formats/#text-based-format
 * @export
 * @class PrometheusMetricReporter
 * @extends {MetricReporter}
 */
export class PrometheusMetricReporter extends MetricReporter {

    private static isEmpty(value: string): boolean {
        return !value || value.trim() === "";
    }

    private options: Options;
    private clock: Clock;
    private minReportingTimeout: number;
    private tags: Map<string, string>;
    private metricStates: Map<number, MetricEntry> = new Map();
    private counterType: MetricType = "counter";
    private gaugeType: MetricType = "gauge";
    private histogramType: MetricType = "histogram";
    private summaryType: MetricType = "summary";

    public constructor(
        options: Options = new Options(),
        tags: Map<string, string> = new Map(),
        clock: Clock = new StdClock(),
        minReportingTimeout = 1) {
        super();

        this.options = options;
        this.tags = tags;
        this.clock = clock;
        this.minReportingTimeout = MINUTE.convertTo(minReportingTimeout, MILLISECOND);

        if (options.useUntyped) {
            this.counterType = "untyped";
            this.gaugeType = "untyped";
            this.histogramType = "untyped";
            this.summaryType = "untyped";
        }
    }

    public getTags(): Map<string, string> {
        return this.tags;
    }

    public setTags(tags: Map<string, string>): void {
        this.tags = tags;
    }

    public getMetricsString(): string {
        if (this.metricRegistries && this.metricRegistries.length > 0) {
            return this.metricRegistries
                .map((registry) => this.reportMetricRegistry(registry))
                .join("") + "\n";
        }
        return "\n";
    }

    public start(): void {
    }

    public stop(): void {
    }

    private reportMetricRegistry(r: MetricRegistry): string {
        const now: Date = new Date(this.clock.time().milliseconds);

        const monotoneCounters = this.reportMetrics(r.getMonotoneCounterList(), now,
            (c: MonotoneCounter) => this.getCounterString(now, c),
            (c: MonotoneCounter) => c.getCount());
        const counters = this.reportMetrics(r.getCounterList(), now,
            (c: Counter) => this.getCounterGaugeString(now, c),
            (c: Counter) => c.getCount());
        const gauges = this.reportMetrics(r.getGaugeList(), now,
            (g: Gauge<any>) => this.getGaugeString(now, g),
            (g: Gauge<any>) => g.getValue());
        const histograms = this.reportMetrics(r.getHistogramList(), now,
            (h: Histogram) => this.getHistogramString(now, h),
            (h: Histogram) => h.getCount());
        const meters = this.reportMetrics(r.getMeterList(), now,
            (m: Meter) => this.getMeterString(now, m),
            (m: Meter) => m.getCount());
        const timers = this.reportMetrics(r.getTimerList(), now,
            (t: Timer) => this.getTimerString(now, t),
            (t: Timer) => t.getCount());

        return []
            .concat(monotoneCounters)
            .concat(counters)
            .concat(gauges)
            .concat(histograms)
            .concat(meters)
            .concat(timers)
            .join("\n");
    }

    private reportMetrics<T extends Metric>(
        metrics: T[],
        date: Date,
        reportFn: (metric: T) => string,
        lastFn: (metric: Metric) => number): string[] {

        return metrics
            .filter((metric) => !(metric as any).id || this.hasChanged((metric as any).id, lastFn(metric), date))
            .map((metric) => reportFn(metric));
    }

    private getMetricString<T extends Metric>(
        now: Date,
        metric: T,
        metricType: MetricType,
        canReport: (metric: T) => boolean,
        getValues: (metric: T) => { [key: string]: number; },
        ): string {

        if (!canReport(metric)) {
            return "";
        }

        const metricName = this.getMetricName(metric);
        const values = getValues(metric);
        let timestamp = "";

        if (this.options.includeTimestamp) {
            timestamp = ` ${now.getUTCMilliseconds()}`;
        }

        const tags = this.buildTags(metric);
        const tagStr = Object
            .keys(tags)
            .map((tag) => `${tag}="${tags[tag]}"`)
            .join(",");

        return Object
            .keys(values)
            .map((field) => {
                const fieldStr = PrometheusMetricReporter.isEmpty(field) ? "" : `_${field}`;
                let description = metric.getDescription();
                let valueStr = `${values[field]}`;

                if (PrometheusMetricReporter.isEmpty(description)) {
                    description = `${metricName}${fieldStr} description`;
                }

                if (!Number.isFinite(values[field])) {
                    if (values[field] === -Infinity) {
                        valueStr = "-Inf";
                    } else if (values[field] === Infinity) {
                        valueStr = "+Inf";
                    }
                }

                if (this.options.emitComments === true) {
                    return  `# HELP ${metricName}${fieldStr} ${description}\n` +
                            `# TYPE ${metricName}${fieldStr} ${metricType}\n` +
                            `${metricName}${fieldStr}{${tagStr}} ${valueStr}${timestamp}\n`;
                } else {
                    return `${metricName}${fieldStr}{${tagStr}} ${valueStr}${timestamp}\n`;
                }
            })
            .join("");
    }

    private getCounterString(now: Date, counter: MonotoneCounter): string {
        return this.getMetricString(
            now,
            counter,
            this.counterType,
            (metric) => true,
            (metric) => ({
                total: counter.getCount() || 0,
            }));
    }

    private getCounterGaugeString(now: Date, counter: Counter): string {
        return this.getMetricString(
            now,
            counter,
            this.gaugeType,
            (metric) => true,
            (metric) => ({
                "": counter.getCount() || 0,
            }));
    }

    private getGaugeString(now: Date, gauge: Gauge<any>): string {
        return this.getMetricString(
            now,
            gauge,
            this.gaugeType,
            (metric) => true,
            (metric) => ({
                "": gauge.getValue(),
            }));
    }

    private getHistogramString(now: Date, histogram: Histogram): string {
        return this.getMetricString(
            now,
            histogram,
            this.histogramType,
            (metric) => !isNaN(histogram.getCount()),
            (metric) => {
                const snapshot = histogram.getSnapshot();
                return {
                    max: this.getNumber(snapshot.getMax()),
                    mean: this.getNumber(snapshot.getMean()),
                    min: this.getNumber(snapshot.getMin()),
                    p50: this.getNumber(snapshot.getMedian()),
                    p75: this.getNumber(snapshot.get75thPercentile()),
                    p95: this.getNumber(snapshot.get95thPercentile()),
                    p98: this.getNumber(snapshot.get98thPercentile()),
                    p99: this.getNumber(snapshot.get99thPercentile()),
                    p999: this.getNumber(snapshot.get999thPercentile()),
                    stddev: this.getNumber(snapshot.getStdDev()),
                };
            });
    }

    private getMeterString(now: Date, meter: Meter): string {
        return this.getMetricString(
            now,
            meter,
            this.histogramType,
            (metric) => !isNaN(meter.getCount()),
            (metric) => {
                return {
                    count: meter.getCount() || 0,
                    m15_rate: this.getNumber(meter.get15MinuteRate()),
                    m1_rate: this.getNumber(meter.get1MinuteRate()),
                    m5_rate: this.getNumber(meter.get5MinuteRate()),
                    mean_rate: this.getNumber(meter.getMeanRate()),
                };
            });
    }

    private getTimerString(now: Date, timer: Timer): string {
        return this.getMetricString(
            now,
            timer,
            this.summaryType,
            (metric) => !isNaN(timer.getCount()),
            (metric) => {
                const snapshot = timer.getSnapshot();
                return {
                    count: timer.getCount() || 0,
                    m15_rate: this.getNumber(timer.get15MinuteRate()),
                    m1_rate: this.getNumber(timer.get1MinuteRate()),
                    m5_rate: this.getNumber(timer.get5MinuteRate()),
                    max: this.getNumber(snapshot.getMax()),
                    mean: this.getNumber(snapshot.getMean()),
                    mean_rate: this.getNumber(timer.getMeanRate()),
                    min: this.getNumber(snapshot.getMin()),
                    p50: this.getNumber(snapshot.getMedian()),
                    p75: this.getNumber(snapshot.get75thPercentile()),
                    p95: this.getNumber(snapshot.get95thPercentile()),
                    p98: this.getNumber(snapshot.get98thPercentile()),
                    p99: this.getNumber(snapshot.get99thPercentile()),
                    p999: this.getNumber(snapshot.get999thPercentile()),
                    stddev: this.getNumber(snapshot.getStdDev()),
                };
            });
    }

    private hasChanged(metricId: number, lastValue: number, date: Date): boolean {
        let changed = true;
        let metricEntry = {
            lastReport: 0,
            lastValue,
        };
        if (this.metricStates.has(metricId)) {
            metricEntry = this.metricStates.get(metricId);
            changed = metricEntry.lastValue !== lastValue;
            if (!changed) {
                changed = metricEntry.lastReport + this.minReportingTimeout < date.getTime();
            }
        }
        if (changed) {
            metricEntry.lastReport = date.getTime();
        }
        this.metricStates.set(metricId, metricEntry);
        return changed;
    }

    private getMetricName(metric: Metric): string {
        if (metric.getGroup()) {
            return `${metric.getGroup()}:${metric.getName()}`;
        }
        return metric.getName();
    }

    private buildTags(taggable: Taggable): { [key: string]: string } {
        const tags: { [x: string]: string } = {};
        this.tags.forEach((tag, key) => tags[key] = tag);
        taggable.getTags().forEach((tag, key) => tags[key] = tag);
        return tags;
    }

    private getNumber(value: number): number {
        if (isNaN(value)) {
            return 0;
        }
        return value;
    }

}
