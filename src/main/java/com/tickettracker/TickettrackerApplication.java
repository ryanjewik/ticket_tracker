package com.tickettracker;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class TickettrackerApplication {
    public static void main(String[] args) {
        SpringApplication.run(TickettrackerApplication.class, args);
        System.out.println("Server is running on http://localhost:8080");
    }
}
