// Package metrics defines the edge's Prometheus metrics. Labels are kept to
// small fixed sets; endpoint IDs and slugs are never labels.
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
)

// Metrics groups the edge's collectors.
type Metrics struct {
	Registry *prometheus.Registry

	IntakeDuration *prometheus.HistogramVec
	IntakeBytes    prometheus.Counter
	IntakeRejects  *prometheus.CounterVec
	BodiesOffload  prometheus.Counter
	Degraded       *prometheus.CounterVec
	SSEClients     prometheus.Gauge
	SSEEvents      prometheus.Counter
}

// New registers every collector, plus Go runtime and process metrics, on a
// fresh registry.
func New() *Metrics {
	reg := prometheus.NewRegistry()
	m := &Metrics{
		Registry: reg,
		IntakeDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Namespace: "hookline",
			Subsystem: "intake",
			Name:      "duration_seconds",
			Help:      "Time from receiving a webhook to sending the response, excluding configured response delays.",
			Buckets:   []float64{.001, .0025, .005, .01, .025, .05, .1, .25, .5, 1, 2.5},
		}, []string{"outcome"}),
		IntakeBytes: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: "hookline", Subsystem: "intake", Name: "body_bytes_total",
			Help: "Bytes of request bodies captured.",
		}),
		IntakeRejects: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "hookline", Subsystem: "intake", Name: "rejects_total",
			Help: "Requests not captured, by reason.",
		}, []string{"reason"}),
		BodiesOffload: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: "hookline", Subsystem: "intake", Name: "offloaded_bodies_total",
			Help: "Bodies larger than the inline limit stored in object storage.",
		}),
		Degraded: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "hookline", Subsystem: "edge", Name: "degraded_operations_total",
			Help: "Operations that failed open because a dependency was unavailable.",
		}, []string{"dependency", "operation"}),
		SSEClients: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "hookline", Subsystem: "stream", Name: "clients",
			Help: "Open SSE connections on this instance.",
		}),
		SSEEvents: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: "hookline", Subsystem: "stream", Name: "events_total",
			Help: "Live events written to SSE clients (excluding pings and replays).",
		}),
	}
	reg.MustRegister(
		m.IntakeDuration, m.IntakeBytes, m.IntakeRejects, m.BodiesOffload, m.Degraded,
		m.SSEClients, m.SSEEvents,
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
	)
	return m
}
