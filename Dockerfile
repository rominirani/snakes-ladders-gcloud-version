FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

RUN groupadd --gid 10001 appgroup && \
    useradd --uid 10001 --gid appgroup --no-create-home --shell /usr/sbin/nologin appuser

WORKDIR /app

COPY index.html styles.css scenarios.js game.js server.py /app/
COPY packs /app/packs/

RUN chown -R appuser:appgroup /app && chmod -R a-w /app

USER appuser

EXPOSE 8080

CMD ["python3", "/app/server.py", "--cloud-run"]
