package com.tickettracker;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;

@Component
public class UpstreamClients {
    private static final Logger log = LoggerFactory.getLogger(UpstreamClients.class);

    private final WebClient http;
    private final TrackerProperties props;
    private static final Instant START = Instant.now();
    // SeatGeek
    @Value("${SEATGEEK_CLIENT_ID:}")
    private String seatGeekClientId;

    // Optional direct event id (skip search)
    @Value("${TICKETWATCH_SEATGEEK_EVENT_ID:}")
    private String seatGeekEventId;

    // Dummy knobs (env / .env)
    @Value("${DUMMY_BASE:150}")
    private double dummyBase;

    @Value("${DUMMY_VOL:20}")
    private double dummyVol;

    @Value("${DUMMY_TREND_PER_HOUR:0}")
    private double dummyTrendPerHour;

    @Value("${DUMMY_SPIKE_PCT:0}")
    private double dummySpikePct;

    @Value("${DUMMY_SPIKE_EVERY_HOURS:0}")
    private double dummySpikeEveryHours;

    @Value("${DUMMY_OUTLIER_PCT:0.0}")
    private double dummyOutlierPct;

    @Value("${DUMMY_SEED:0}")
    private long dummySeed;

    public UpstreamClients(WebClient.Builder builder, TrackerProperties props) {
        this.http = builder.build();
        this.props = props;
    }

    /** What TicketPoller expects: fetch stats (min/avg/median), not raw prices. */
    public PriceStats fetchSeatGeek() {
        String a = props.artist();
        String v = props.venue();
        String d = props.date();

        List<Double> prices;
        try {
            LocalDate ld = (d == null || d.isBlank()) ? null : LocalDate.parse(d);
            prices = seatGeekPrices(a, v, ld);
        } catch (Exception e) {
            log.warn("SeatGeek fetch failed for ({}, {}, {}): {}", a, v, d, e.toString());
            prices = Collections.emptyList();
        }
        return summarize(prices);
    }

    /** Main entry if you need the raw list elsewhere. */
    public List<Double> seatGeekPrices(String artist, String venue, LocalDate date) {
        if (Boolean.TRUE.equals(props.dummy()) || seatGeekClientId == null || seatGeekClientId.isBlank()) {
            return generateDummyPrices(artist, venue, date);
        }
        try {
            Map<String, Object> json = fetchSeatGeekEventJson(artist, venue, date);
            List<Double> prices = extractSeatGeekPrices(json);
            if (prices == null || prices.isEmpty()) {
                log.info("SeatGeek -> no price data this poll (artist='{}', venue='{}', date='{}')", artist, venue, date);
                return Collections.emptyList();
            }
            return prices;
        } catch (Exception ex) {
            log.warn("SeatGeek call failed; returning empty list. {}", ex.toString());
            return Collections.emptyList();
        }
    }

    /** Keep a stub for Ticketmaster so code compiles; not used now. */
    public List<Double> ticketmasterPrices(String artist, String venue, LocalDate date) {
        return Collections.emptyList();
    }

    // ----------------- SeatGeek helpers -----------------

    @SuppressWarnings("unchecked")
    private Map<String, Object> fetchSeatGeekEventJson(String artist, String venue, LocalDate date) {
        if (seatGeekEventId != null && !seatGeekEventId.isBlank()) {
            String url = "https://api.seatgeek.com/2/events/" + seatGeekEventId + "?client_id=" + seatGeekClientId;
            return getJson(url);
        } else {
            // You can add a search implementation later if you like.
            log.info("SeatGeek EVENT_ID not set; skipping search.");
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    private List<Double> extractSeatGeekPrices(Map<String, Object> json) {
        if (json == null) return Collections.emptyList();

        Map<String, Object> statsMap = null;

        Object statsObj = json.get("stats");
        if (statsObj instanceof Map<?, ?> m1) {
            statsMap = (Map<String, Object>) m1;
        } else {
            Object eventsObj = json.get("events");
            if (eventsObj instanceof List<?> evs && !evs.isEmpty() && evs.get(0) instanceof Map<?, ?> first) {
                Object s2 = ((Map<?, ?>) first).get("stats");
                if (s2 instanceof Map<?, ?> m2) {
                    statsMap = (Map<String, Object>) m2;
                }
            }
        }
        if (statsMap == null) return Collections.emptyList();

        Double low  = num(statsMap.get("lowest_price"));
        Double avg  = num(statsMap.get("average_price"));
        Double med  = num(statsMap.get("median_price"));
        Double high = num(statsMap.get("highest_price"));

        if (low != null || avg != null || med != null || high != null) {
            double center = coalesce(avg, med, low, high, 120.0);
            double floor  = (low  != null) ? low  : Math.max(10.0, center * 0.6);
            double ceil   = (high != null) ? high : Math.max(center * 1.3, center + 40.0);

            int n = 40;
            List<Double> prices = new ArrayList<>(n);
            Random r = new Random(42L);
            double sigma = Math.max(8.0, (ceil - floor) / 10.0);

            for (int i = 0; i < n; i++) {
                double p = center + r.nextGaussian() * sigma;
                p = Math.max(floor, Math.min(ceil, p));
                prices.add(round2(p));
            }
            if (low  != null) prices.set(r.nextInt(n), round2(low));
            if (high != null) prices.set(r.nextInt(n), round2(high));
            if (med  != null) prices.set(r.nextInt(n), round2(med));
            if (avg  != null) prices.set(r.nextInt(n), round2(avg));
            return prices;
        }
        return Collections.emptyList();
    }

    private static Double num(Object o) {
        if (o instanceof Number n) return n.doubleValue();
        if (o instanceof String s) {
            try { return Double.parseDouble(s); } catch (Exception ignored) {}
        }
        return null;
    }

    private static double coalesce(Double... vals) {
        for (Double v : vals) if (v != null) return v;
        return 0.0;
    }

    private static double round2(double d) {
        return Math.round(d * 100.0) / 100.0;
    }

    private Map<String, Object> getJson(String url) {
        return http.get()
                .uri(url)
                .accept(MediaType.APPLICATION_JSON)
                .retrieve()
                .bodyToMono(new ParameterizedTypeReference<Map<String, Object>>() {})
                .onErrorResume(ex -> {
                    log.warn("GET {} failed: {}", url, ex.toString());
                    return Mono.empty();
                })
                .blockOptional()
                .orElse(null);
    }

    // ----------------- Stats & Dummy generator -----------------

    /** Convert a list of prices into a PriceStats; returns null if list is empty. */
    private PriceStats summarize(List<Double> prices) {
        if (prices == null || prices.isEmpty()) return null;

        List<Double> copy = new ArrayList<>(prices);
        copy.removeIf(Objects::isNull);
        if (copy.isEmpty()) return null;

        Collections.sort(copy);
        double min = copy.get(0);
        double avg = copy.stream().mapToDouble(Double::doubleValue).average().orElse(Double.NaN);
        double median;
        int n = copy.size();
        if (n % 2 == 1) {
            median = copy.get(n / 2);
        } else {
            median = (copy.get(n / 2 - 1) + copy.get(n / 2)) / 2.0;
        }
        return new PriceStats(min, avg, median);
    }

    private List<Double> generateDummyPrices(String artist, String venue, LocalDate date) {
        // time-based drift so trends are visible
        // at class level (top of UpstreamClients)

        // inside generateDummyPrices(...)
        Instant now = Instant.now();
        double hours = Duration.between(START, now).toMinutes() / 60.0; // small, keeps growing from 0


        long seed = (dummySeed != 0L)
                ? dummySeed
                : Objects.hash(
                    artist == null ? "" : artist,
                    venue  == null ? "" : venue,
                    date   == null ? "" : date.toString()
                );
        long timeSalt = Double.doubleToLongBits(hours);
        Random rng = new Random(seed ^ timeSalt);

        double center = dummyBase + dummyTrendPerHour * hours;

        // periodic sale spike (negative pct = drop)
        if (dummySpikeEveryHours > 0) {
            double phase = (hours % dummySpikeEveryHours) / dummySpikeEveryHours;
            double spikeShape = Math.exp(-Math.pow((phase - 0.05) / 0.05, 2)); // sharp near start of window
            center = center * (1.0 + dummySpikePct * spikeShape);
        }

        int n = 60; // pretend ~60 listings
        double vol = Math.max(0.0, dummyVol);
        double outlier = Math.max(0.0, Math.min(0.5, dummyOutlierPct));

        List<Double> prices = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            // Gaussian-ish via CLT
            double noise = 0;
            for (int k = 0; k < 3; k++) noise += (rng.nextDouble() * 2.0 - 1.0);
            noise /= 3.0;

            double p = center + noise * vol;

            // occasional outliers (both cheaper and pricier)
            if (rng.nextDouble() < outlier) {
                double sign = rng.nextBoolean() ? -1.0 : 1.0;
                p += sign * (vol * 2.5);
            }

            p = Math.max(10.0, p);
            prices.add(round2(p));
        }
        return prices;
    }
}
