#!/usr/bin/env bash
set -euo pipefail

if [[ -z ${GOOGLE_CLOUD_PROJECT-} ]]; then
	echo "GOOGLE_CLOUD_PROJECT is required" >&2
	exit 2
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "${ROOT}"

VERTEX_LOCATION="${VERTEX_LOCATION:-global}"
PROXY_PORT="${PROXY_PORT:-8765}"
E2E_MODELS="${E2E_MODELS:-gemini-3.8-flash}"

if ! [[ ${PROXY_PORT} =~ ^[0-9]+$ ]] || ((PROXY_PORT < 1 || PROXY_PORT > 65535)); then
	echo "PROXY_PORT must be an integer between 1 and 65535" >&2
	exit 3
fi
if ! command -v lsof >/dev/null 2>&1; then
	echo "lsof is required" >&2
	exit 3
fi

PROXY_PID=""
FAILURES=0
API_KEY=""
LOG_FILE=""

cleanup() {
	local status=$?
	trap - EXIT
	trap '' INT TERM HUP QUIT
	if [[ -n ${PROXY_PID} ]]; then
		kill "${PROXY_PID}" 2>/dev/null || true
	fi
	if [[ ${status} -ne 0 || ${FAILURES} -ne 0 ]]; then
		echo "--- proxy log (last 20 lines, key filtered) ---" >&2
		grep -vF -e "${API_KEY:-__no_key__}" -e "${GOOGLE_CLOUD_PROJECT:-__no_project__}" -e 'vertexai-proxy API key: ' "${LOG_FILE}" | tail -n 20 >&2 || true
	fi
	rm -f "${LOG_FILE}"
	if [[ -n ${PROXY_PID} ]]; then
		wait "${PROXY_PID}" 2>/dev/null || true
	fi
	exit "${status}"
}

LOG_FILE="$(mktemp "${TMPDIR:-/tmp}/vertexai-proxy-e2e.XXXXXX")"
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
trap 'exit 131' QUIT
chmod 600 "${LOG_FILE}"

echo "Building proxy"
pnpm --filter @vertexai-proxy/server build >/dev/null

if lsof -nP -iTCP:"${PROXY_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
	echo "Port ${PROXY_PORT} is already in use" >&2
	exit 3
fi

echo "Starting proxy on port ${PROXY_PORT}"
GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT}" \
	VERTEX_LOCATION="${VERTEX_LOCATION}" \
	VERTEX_MODELS="${E2E_MODELS}" \
	PROXY_PORT="${PROXY_PORT}" \
	node packages/proxy/dist/server.js >"${LOG_FILE}" 2>&1 &
PROXY_PID=$!

for ((i = 0; i < 200; i++)); do
	API_KEY="$(sed -n 's/^vertexai-proxy API key: //p' "${LOG_FILE}")"
	if [[ -n ${API_KEY} ]] && grep -q 'vertexai-proxy listening on ' "${LOG_FILE}"; then
		break
	fi
	if ! kill -0 "${PROXY_PID}" 2>/dev/null; then
		echo "Proxy exited before becoming ready" >&2
		exit 4
	fi
	sleep 0.1
done

if [[ -z ${API_KEY} ]] || ! grep -q 'vertexai-proxy listening on ' "${LOG_FILE}"; then
	echo "Proxy did not become ready within 20 seconds" >&2
	exit 4
fi

check_http() {
	local label=$1
	local expected=$2
	shift 2
	local response code body
	if ! response="$(curl -sS -m 90 -w $'\n%{http_code}' "$@" 2>&1)"; then
		echo "FAIL ${label}: curl failed"
		FAILURES=$((FAILURES + 1))
		return
	fi
	code="${response##*$'\n'}"
	body="${response%$'\n'*}"
	if [[ ${code} != "${expected}" ]]; then
		echo "FAIL ${label}: HTTP ${code} ${body:0:200}"
		FAILURES=$((FAILURES + 1))
		return
	fi
	echo "PASS ${label}"
}

check_chat() {
	local model=$1
	local response code body
	if ! response="$(curl -sS -m 90 -w $'\n%{http_code}' \
		"http://127.0.0.1:${PROXY_PORT}/v1/chat/completions" \
		-H "Authorization: Bearer ${API_KEY}" \
		-H 'Content-Type: application/json' \
		-d "{\"model\":\"${model}\",\"messages\":[{\"role\":\"user\",\"content\":\"Say hello in one short sentence.\"}]}" 2>&1)"; then
		echo "FAIL ${model}: curl failed"
		FAILURES=$((FAILURES + 1))
		return
	fi
	code="${response##*$'\n'}"
	body="${response%$'\n'*}"
	if [[ ${code} != 200 ]]; then
		echo "FAIL ${model}: HTTP ${code} ${body:0:200}"
		FAILURES=$((FAILURES + 1))
		return
	fi
	if ! printf '%s' "${body}" | node -e '
let data = "";
process.stdin.on("data", (chunk) => { data += chunk; });
process.stdin.on("end", () => {
	const value = JSON.parse(data);
	const content = value?.choices?.[0]?.message?.content;
	if (typeof content !== "string" || content.length === 0) process.exit(1);
});
' >/dev/null; then
		echo "FAIL ${model}: HTTP ${code} ${body:0:200}"
		FAILURES=$((FAILURES + 1))
		return
	fi
	echo "PASS ${model}"
}

check_http healthz 200 "http://127.0.0.1:${PROXY_PORT}/healthz"
check_http models 200 "http://127.0.0.1:${PROXY_PORT}/v1/models" -H "Authorization: Bearer ${API_KEY}"
check_http models-no-key 401 "http://127.0.0.1:${PROXY_PORT}/v1/models"

IFS=',' read -r -a MODELS <<<"${E2E_MODELS}"
for model in "${MODELS[@]}"; do
	model="${model//[[:space:]]/}"
	if [[ -z ${model} ]]; then
		continue
	fi
	check_chat "${model%%=*}"
done

if [[ ${FAILURES} -ne 0 ]]; then
	echo "${FAILURES} check(s) failed" >&2
	exit 1
fi

echo "All e2e checks passed"
