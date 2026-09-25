#!/usr/bin/env bash
# Healthy only when Valhalla answers /status (the graph is loaded and served).
# Uses bash's /dev/tcp so it does not depend on curl being present in the image.
set -euo pipefail
exec 3<>/dev/tcp/127.0.0.1/8002
printf 'GET /status HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n' >&3
IFS= read -r -t 4 status_line <&3
[[ "$status_line" == *" 200 "* ]]
