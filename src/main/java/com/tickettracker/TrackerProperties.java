package com.tickettracker;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class TrackerProperties {

    @Value("${TICKETWATCH_ARTIST:}")
    private String artist;

    @Value("${TICKETWATCH_VENUE:}")
    private String venue;

    // Keep as String (we’ll parse where needed)
    @Value("${TICKETWATCH_DATE:}")
    private String date;

    // Cron with seconds (default: every 15 minutes)
    @Value("${TICKETWATCH_CRON:0 */15 * * * *}")
    private String cron;

    // Dummy mode toggle
    @Value("${TICKETWATCH_DUMMY:true}")
    private Boolean dummy;

    // ---- functional getters (fluent) ----
    public String artist() { return artist; }
    public String venue()  { return venue; }
    public String date()   { return date; }
    public String cron()   { return cron; }
    public Boolean dummy() { return dummy; }

    // ---- conventional getters (compat with existing code) ----
    public String getArtist() { return artist; }
    public String getVenue()  { return venue; }
    public String getDate()   { return date; }
    public String getCron()   { return cron; }
    public Boolean getDummy() { return dummy; }
}
