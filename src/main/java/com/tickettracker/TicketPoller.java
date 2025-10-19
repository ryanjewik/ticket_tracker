
package com.tickettracker;

import java.time.LocalDate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class TicketPoller {
  private static final Logger log = LoggerFactory.getLogger(TicketPoller.class);

  private final PriceMetrics metrics;
  private final UpstreamClients upstream;
  private final TrackerProperties cfg;

  public TicketPoller(PriceMetrics metrics, UpstreamClients upstream, TrackerProperties cfg) {
    this.metrics = metrics; this.upstream = upstream; this.cfg = cfg;
  }

  @EventListener(ApplicationReadyEvent.class)
  public void runOnceOnStartup() {
    log.info("App ready — running initial poll for {} @ {} on {}", cfg.getArtist(), cfg.getVenue(), cfg.getDate());
    poll();
  }

    @Scheduled(cron = "${ticketwatch.poll.cron}")
    public void poll() {
      log.info("Polling ticket platforms… (artist='{}', venue='{}', date='{}')", cfg.getArtist(), cfg.getVenue(), cfg.getDate());
      var statsByPlatform = upstream.aggregateStats(cfg.getArtist(), cfg.getVenue(), LocalDate.parse(cfg.getDate()));

      Double bestMin = null, bestAvg = null, bestMedian = null;
      String bestSource = null;

      for (var entry : statsByPlatform.entrySet()) {
        String platform = entry.getKey();
        PriceStats stats = entry.getValue();
        if (stats != null && stats.min() != null) {
          metrics.set(platform, stats.min(), stats.avg(), stats.median());
          log.info("{} -> min={}, avg={}, median={}", platform, stats.min(), stats.avg(), stats.median());
          if (bestMin == null || stats.min() < bestMin) {
            bestMin = stats.min();
            bestAvg = stats.avg();
            bestMedian = stats.median();
            bestSource = platform;
          }
        } else {
          log.info("{} -> no data this poll", platform);
        }
      }

      // Set 'Best' metrics to the lowest min price found
      if (bestMin != null) {
        metrics.set("Best", bestMin, bestAvg, bestMedian);
        log.info("Best ({}) -> min={}, avg={}, median={}", bestSource, bestMin, bestAvg, bestMedian);
      } else {
        log.info("Best -> no data this poll");
      }
    }
}
