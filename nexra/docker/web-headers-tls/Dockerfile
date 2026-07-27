# First-party image for the web_headers_tls skill. Emits a single JSON line:
#   {"host": "...", "missing": ["Content-Security-Policy", ...], "tls": {"weak": bool}}
# so the deterministic parser (summarizeSkill 'web_headers_tls') can turn gaps
# into candidate findings without the model parsing raw output.
#
# Build:  docker build -t nexra/web-headers-tls:latest nexra/docker/web-headers-tls
#
# The skill invokes:  check-headers-tls "<url>" [ -H "<auth header>" ]
FROM python:3.12-alpine
RUN apk add --no-cache openssl curl
COPY check-headers-tls /usr/local/bin/check-headers-tls
RUN chmod +x /usr/local/bin/check-headers-tls
ENTRYPOINT ["check-headers-tls"]
