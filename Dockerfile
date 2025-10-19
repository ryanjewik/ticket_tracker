# syntax=docker/dockerfile:1

########## BUILD STAGE (compile with JDK 24) ##########
FROM eclipse-temurin:24-jdk AS build
WORKDIR /workspace

# Copy Gradle wrapper & configs first (cache-friendly)
COPY gradlew settings.gradle build.gradle ./
COPY gradle ./gradle
# (optional) if present; must NOT contain org.gradle.java.home
COPY gradle.properties ./gradle.properties

# Ensure wrapper is executable (Windows -> Linux)
RUN chmod +x gradlew

# Sanity
RUN java -version && ./gradlew --no-daemon --version

# Copy sources and build
COPY src ./src
RUN ./gradlew --no-daemon clean bootJar -x test

########## RUNTIME STAGE (run on JRE 25) ##########
FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=build /workspace/build/libs/*.jar /app/app.jar
RUN apt-get update && apt-get install -y wget jq unzip
RUN mkdir -p /home/app && chmod 777 /home/app
RUN apt-get update && apt-get install -y wget jq unzip && rm -rf /var/lib/apt/lists/*



# Keep Spring from trying to manage Docker Compose inside the container
ENV SPRING_DOCKER_COMPOSE_ENABLED=false

EXPOSE 8080
ENTRYPOINT ["java","-jar","/app/app.jar"]
