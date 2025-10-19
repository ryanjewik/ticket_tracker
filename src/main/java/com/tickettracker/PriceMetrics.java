package com.tickettracker;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;

@Component
public class PriceMetrics {
  private final Map<String, AtomicReference<Double>> min = new ConcurrentHashMap<>();
  private final Map<String, AtomicReference<Double>> avg = new ConcurrentHashMap<>();
  private final Map<String, AtomicReference<Double>> median = new ConcurrentHashMap<>();

  public PriceMetrics(MeterRegistry reg, TrackerProperties cfg) {
    for (String source : new String[]{"Best"}) {
      min.put(source, registerGauge(reg, "ticket_min_price", cfg, source));
      avg.put(source, registerGauge(reg, "ticket_avg_price", cfg, source));
      median.put(source, registerGauge(reg, "ticket_median_price", cfg, source));
    }
  }

  private AtomicReference<Double> registerGauge(MeterRegistry reg, String name,
                                                TrackerProperties cfg, String source) {
    AtomicReference<Double> ref = new AtomicReference<>(Double.NaN);
    Gauge.builder(name, ref, r -> {
      Double v = r.get();
      return v == null ? Double.NaN : v.doubleValue();
    })
      .description("Ticket price metric")
      .tag("artist", cfg.getArtist())
      .tag("venue", cfg.getVenue())
      .tag("date", cfg.getDate())
      .tag("source", source)
      .register(reg);
    return ref;
  }

  public void set(String source, Double minV, Double avgV, Double medV) {
    if (minV != null)   min.get(source).set(minV);
    if (avgV != null)   avg.get(source).set(avgV);
    if (medV != null) median.get(source).set(medV);
  }
}
