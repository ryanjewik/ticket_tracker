# 🎟️ TicketWatch — Automated Ticket Price Tracker

**TicketWatch** is a Node.js + Puppeteer scraping system that automatically tracks concert ticket prices across multiple sources (**StubHub**, **VividSeats**, and **Ticketmaster**) and exposes metrics for visualization and alerting via **Prometheus** and **Grafana**.

---

## 🧬 Features

- 🔁 Automated scraping every 30 minutes using **node-cron**
- 🧠 Human-like navigation via Puppeteer (Bright Data WSE compatible)
- 🍪 Site persistence (cookies + localStorage) to reduce bot detection
- 📈 Prometheus metrics:  
  `ticket_min_price`, `ticket_avg_price`, `ticket_median_price`, `ticket_count`
- 🧮 Grafana dashboards for price trends by source
- 📩 Email alerts from Grafana when:
  - Minimum price < $40 for 1 hour  
  - Average price drops ≥ 20 % for 1 hour
- 🐳 Fully containerized via **Docker Compose**

---

## 💇️‍♂️ Project Structure

```
tickettracker/
├── src/
│   ├── index.ts                  # main scrape runner and browser logic
│   ├── server.ts                 # metrics endpoint & cron scheduler
│   ├── parse_stubhub.ts          # StubHub HTML parser
│   ├── parse_ticketmaster.ts     # Ticketmaster HTML parser
│   ├── parse_vividseats.ts       # VividSeats HTML parser
│   ├── cookies_and_localstorage.ts
│   └── utils.ts                  # filesystem helpers, session dir management
│
├── grafana-provisioning/
│   ├── dashboards/               # tickets-overview.json + dashboards.yml
│   ├── alerting/                 # contact-points.yml, notification-policies.yml, rules.yaml
│   └── datasources/              # prometheus.yml
│
├── prometheus.yml                # Prometheus scrape config
├── compose.yaml                  # Docker stack: scraper + Prometheus + Grafana
├── .env                          # site URLs, cron schedule, and env vars
└── session/                      # stored cookies, LS, and HTML snapshots
```

---

## ⚙️ Setup

### 1️⃣ Environment Variables (`.env`)
```bash
STUBHUB_URL="https://www.stubhub.com/lamp-anaheim-tickets-11-7-2025/event/159015267/"
VIVIDSEATS_URL="https://www.vividseats.com/lamp-tickets-anaheim-house-of-blues-anaheim-11-6-2025/..."
TICKETMASTER_URL="https://www.ticketmaster.com/lamp-future-behind-me-anaheim-california-11-06-2025/event/090062DEE1124BFB"
SESSION_BASE_DIR="/app/.session_data"
SCHEDULE_CRON="*/30 * * * *"  # every 30 minutes
TZ="America/Los_Angeles"
```

### 2️⃣ Build & Run
```bash
npm install
npm run build
docker compose up -d --build
```

This starts:
- **scraper** — Puppeteer scraping service (exposes `/metrics` on :9464)  
- **prometheus** — scrapes scraper metrics (port :9090)  
- **grafana** — dashboards & alerts (port :3000 → http://localhost:3000, admin/admin)

---

## 📊 Monitoring & Alerting

- Prometheus collects metrics from the scraper every 30 seconds.  
- Grafana visualizes prices by source and provides 1-hour sustained alerts:
  - **Low Price Alert:** min < $40  
  - **Avg Drop Alert:** avg ≤ 80 % of 12 h baseline  

Grafana uses your SMTP server (`mail.ryanhideosmtp.com`) for email notifications defined in:

```
grafana-provisioning/alerting/
├── contact-points.yml
├── notification-policies.yml
└── rules.yaml
```

---

## 🖥️ Access

| Service     | URL / Port | Description |
|--------------|------------|--------------|
| Scraper Metrics | `http://localhost:9464/metrics` | Prometheus-formatted metrics |
| Prometheus | `http://localhost:9090` | Raw metric queries |
| Grafana | `http://localhost:3000` | Dashboards & Alerts (login admin/admin) |

---

## 🧰 Tech Stack

- **Node.js + TypeScript** — scraping & scheduling  
- **Puppeteer / Bright Data WSE** — browser automation  
- **Prometheus** — metric storage  
- **Grafana** — visualization & alerting  
- **Docker Compose** — orchestration  
- **Postfix SMTP** — outbound email alerts

---

© 2025 TicketWatch – Automated Ticket Price Tracking