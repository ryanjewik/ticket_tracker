package com.tickettracker;

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
    log.info("Polling SeatGeek… (artist='{}', venue='{}', date='{}')", cfg.getArtist(), cfg.getVenue(), cfg.getDate());

    PriceStats sg = null;
    try { sg = upstream.fetchSeatGeek(); }
    catch (Exception e) { log.warn("SeatGeek fetch failed: {}", e.toString()); }

    if (sg != null) {
      metrics.set("SeatGeek", sg.min(), sg.avg(), sg.median());
      // “Best” == SeatGeek in this simplified build
      metrics.set("Best", sg.min(), sg.avg(), sg.median());
      log.info("SeatGeek -> min={}, avg={}, median={}", sg.min(), sg.avg(), sg.median());
    } else {
      log.info("SeatGeek -> no data this poll (likely no client_id or no stats yet)");
    }
  }
}
