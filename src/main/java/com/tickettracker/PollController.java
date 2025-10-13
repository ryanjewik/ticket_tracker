package com.tickettracker;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class PollController {
  private final TicketPoller poller;
  public PollController(TicketPoller poller) { this.poller = poller; }

  @PostMapping("/poll")
  public ResponseEntity<String> pollNow() {
    poller.poll();
    return ResponseEntity.ok("polled");
  }
}
