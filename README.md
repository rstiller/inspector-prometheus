# inspector-prometheus
Typescript metric reporter for [prometheus](https://prometheus.io).

<p align="center">
    <a href="https://www.npmjs.org/package/inspector-prometheus">
        <img src="https://img.shields.io/npm/v/inspector-prometheus.svg" alt="NPM Version">
    </a>
    <a href="https://www.npmjs.org/package/inspector-prometheus">
        <img src="https://img.shields.io/npm/l/inspector-prometheus.svg" alt="License">
    </a>
    <a href="https://travis-ci.org/rstiller/inspector-prometheus">
        <img src="http://img.shields.io/travis/rstiller/inspector-prometheus/master.svg" alt="Build Status">
    </a>
    <a href="https://david-dm.org/rstiller/inspector-prometheus">
        <img src="https://img.shields.io/david/rstiller/inspector-prometheus.svg" alt="Dependencies Status">
    </a>
</p>

This library is made for [inspector-metrics](https://github.com/rstiller/inspector-metrics)
node module and is meant to be used with `nodejs`.  

All metrics from the [inspector-metrics](https://github.com/rstiller/inspector-metrics) library
can be pushed to a [pushgateway](https://github.com/prometheus/pushgateway) or be exposed with
a custom `/metrics` endpoint in your application.

## install

`npm install --save inspector-prometheus`

## basic usage

`example.ts`
```typescript
import {
    MetricRegistry,
} from "inspector-metrics";

import {
    PrometheusMetricReporter,
} from "inspector-prometheus";

// contains all metrics
const registry = new MetricRegistry();
// exposes the metrics
const reporter = new PrometheusMetricReporter();

// register the registry within the reporter
reporter.addMetricRegistry(registry);

// common tags for all metrics
const tags = new Map();
tags.set("app_version", "1.0.0");
reporter.setTags(tags);

// a simple request timer used to report response latencies
const requests: Timer = registry.newTimer("requests");
// custom metric tag
requests.setTag("host", "127.0.0.3");

// some server implementation - could be anything KOA, Express, HAPI ...
const server = new Hapi.Server({ host: "0.0.0.0", port: 8080 });

// '/metrics' is the standard route used by prometheus ...
server.route({
    method: "GET",
    path: "/metrics",
    handler(request, h) {
        console.log("reporting metrics");
        return h.response(reporter.getMetricsString())
            .code(200)
            .type("text/plain");
    },
});

// starts the server
server.start();
```

`/etc/prometheus/config.yml`
```yaml
global:
  scrape_interval:     15s
  evaluation_interval: 30s

scrape_configs:
- job_name: test-app
  metrics_path: /metrics
  static_configs:
    - targets:
      - localhost:8080
```

`example metrics report`
```text
# HELP requests request durations for some endpoint
# TYPE requests summary
requests{app_version="1.0.0",host="127.0.0.3",quantile="0.01"} 0
requests{app_version="1.0.0",host="127.0.0.3",quantile="0.05"} 0
requests{app_version="1.0.0",host="127.0.0.3",quantile="0.5"} 999936
requests{app_version="1.0.0",host="127.0.0.3",quantile="0.75"} 999936
requests{app_version="1.0.0",host="127.0.0.3",quantile="0.9"} 1000192
requests{app_version="1.0.0",host="127.0.0.3",quantile="0.95"} 1000192
requests{app_version="1.0.0",host="127.0.0.3",quantile="0.98"} 1999872
requests{app_version="1.0.0",host="127.0.0.3",quantile="0.99"} 2000128
requests{app_version="1.0.0",host="127.0.0.3",quantile="0.999"} 4000000
requests_count{app_version="1.0.0",host="127.0.0.3"} 362
requests_sum{app_version="1.0.0",host="127.0.0.3"} 283998208
```

## reporting options for PrometheusMetricReporter

```typescript
import {
    PrometheusMetricReporter,
    PrometheusReporterOptions,
} from "inspector-prometheus";

const reporter = new PrometheusMetricReporter(new PrometheusReporterOptions(
    true, // includeTimestamp - default is false
    true, // emitComments - default is true
    false, // useUntyped - default is false
));
```

## report metrics with pushgateway

```typescript
import ...; // like in the example above

import {
    PrometheusMetricReporter,
    PushgatewayMetricReporter,
    PushgatewayReporterOptions,
} from "inspector-prometheus";

// contains all metrics
const registry = new MetricRegistry();
// exposes the metrics
const reporter = new PrometheusMetricReporter();

// register the registry within the reporter
reporter.addMetricRegistry(registry);

const pushReporter = new PushgatewayMetricReporter(
    reporter,
    new PushgatewayReporterOptions(
        "localhost", // assuming the pushgateway is running on localhost
        9091, // standard port for pushgateway
        "pushgateway", // id of the job
        "127.0.0.4", // id of the instance
    ));

// start reporting
pushReporter.start();
```

## License

[MIT](https://www.opensource.org/licenses/mit-license.php)