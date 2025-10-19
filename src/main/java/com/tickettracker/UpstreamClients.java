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


    public UpstreamClients(WebClient.Builder builder, TrackerProperties props) {
        this.http = builder.build();
        this.props = props;
    }


    /**
     * Scrape and aggregate prices from all platforms, grouped by platform.
     * @return Map of platform name to list of prices
     */
    public Map<String, List<Double>> scrapeAllPlatforms(String artist, String venue, LocalDate date) {
        Map<String, List<Double>> results = new LinkedHashMap<>();
        log.info("Calling Ticketmaster API for prices...");
        List<Double> tmPrices = ticketmasterPrices(artist, venue, date);
        log.info("TicketmasterAPI scraped prices: {}", tmPrices);
        results.put("TicketmasterAPI", tmPrices);
        return results;
    }

    /**
     * Aggregate stats for each platform.
     */
    public Map<String, PriceStats> aggregateStats(String artist, String venue, LocalDate date) {
        Map<String, List<Double>> allPrices = scrapeAllPlatforms(artist, venue, date);
        Map<String, PriceStats> stats = new LinkedHashMap<>();
        for (var entry : allPrices.entrySet()) {
            stats.put(entry.getKey(), summarize(entry.getValue()));
        }
        return stats;
    }

    /** What TicketPoller expects: fetch stats (min/avg/median), not raw prices. */

    /** Main entry if you need the raw list elsewhere. */

    /** Keep a stub for Ticketmaster so code compiles; not used now. */
    public List<Double> ticketmasterPrices(String artist, String venue, LocalDate date) {
        String apiKey = props.getTicketmasterApiKey();
        if (apiKey == null || apiKey.isEmpty()) {
            log.warn("No Ticketmaster API key configured");
            return Collections.emptyList();
        }
        String eventId = props.getTicketmasterEventId();
        try {
            List<Double> prices = new ArrayList<>();
            if (eventId != null && !eventId.isEmpty()) {
                // Direct event lookup
                String url = "https://app.ticketmaster.com/discovery/v2/events/" + eventId + ".json?apikey=" + apiKey;
                Mono<Map> respMono = http.get()
                    .uri(url)
                    .accept(MediaType.APPLICATION_JSON)
                    .retrieve()
                    .bodyToMono(Map.class);
                Map event = respMono.block(Duration.ofSeconds(10));
                log.info("Ticketmaster raw event response: {}", event);
                if (event != null) {
                    Object priceRangesObj = event.get("priceRanges");
                    if (priceRangesObj instanceof List) {
                        List<Map> priceRanges = (List<Map>) priceRangesObj;
                        for (Map pr : priceRanges) {
                            Object minObj = pr.get("min");
                            Object maxObj = pr.get("max");
                            if (minObj instanceof Number) prices.add(((Number) minObj).doubleValue());
                            if (maxObj instanceof Number) prices.add(((Number) maxObj).doubleValue());
                        }
                    } else {
                        log.warn("No priceRanges found or unexpected format: {}", priceRangesObj);
                    }
                }
                return prices;
            } else {
                // Fallback: search by artist/venue/date
                String baseUrl = "https://app.ticketmaster.com/discovery/v2/events.json";
                String dateStr = date.toString();
                String url = baseUrl + "?apikey=" + apiKey + "&keyword=" + artist + "&venueId=" + venue + "&startDateTime=" + dateStr + "T00:00:00Z&endDateTime=" + dateStr + "T23:59:59Z";
                Mono<Map> respMono = http.get()
                    .uri(url)
                    .accept(MediaType.APPLICATION_JSON)
                    .retrieve()
                    .bodyToMono(Map.class);
                Map resp = respMono.block(Duration.ofSeconds(10));
                if (resp == null || !resp.containsKey("_embedded")) return Collections.emptyList();
                Map embedded = (Map) resp.get("_embedded");
                List<Map> events = (List<Map>) embedded.get("events");
                if (events == null || events.isEmpty()) return Collections.emptyList();
                for (Map event : events) {
                    if (event.containsKey("priceRanges")) {
                        List<Map> priceRanges = (List<Map>) event.get("priceRanges");
                        for (Map pr : priceRanges) {
                            Object minObj = pr.get("min");
                            Object maxObj = pr.get("max");
                            if (minObj instanceof Number) prices.add(((Number) minObj).doubleValue());
                            if (maxObj instanceof Number) prices.add(((Number) maxObj).doubleValue());
                        }
                    }
                }
                return prices;
            }
        } catch (Exception ex) {
            log.error("Ticketmaster API error: {}", ex.getMessage());
            return Collections.emptyList();
        }
    }

    // ----------------- Stats -----------------

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
}
