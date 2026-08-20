#!/bin/sh
set -eu

alerts_env=${FIREFLY_ALERTS_ENV:-/etc/firefly/alerts.env}
[ -r "$alerts_env" ] || exit 0
# shellcheck disable=SC1090
. "$alerts_env"
[ -n "${FEISHU_WEBHOOK_URL:-}" ] || exit 0

event=${1:-unknown}
revision=${2:-unknown}
case_id=${3:-unknown}
duration=${4:-0}
payload=$(EVENT="$event" REVISION="$revision" CASE_ID="$case_id" DURATION="$duration" python3 -c 'import json,os; text="Firefly release: {}\nversion: {}\nduration: {}s\ncase: {}".format(os.environ["EVENT"],os.environ["REVISION"],os.environ["DURATION"],os.environ["CASE_ID"]); print(json.dumps({"msg_type":"text","content":{"text":text}},ensure_ascii=False))')
curl --fail --silent --show-error --max-time 10 -H 'content-type: application/json' --data "$payload" "$FEISHU_WEBHOOK_URL" >/dev/null
