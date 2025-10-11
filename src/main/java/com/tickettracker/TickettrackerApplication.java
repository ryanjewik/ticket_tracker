package com.tickettracker;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class TickettrackerApplication {

	public static void main(String[] args) {
		SpringApplication.run(TickettrackerApplication.class, args);
		System.out.println("Server is running on http://localhost:8080");
	}

}
