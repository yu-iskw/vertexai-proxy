#!/usr/bin/env bash
# vertexai-proxy verification harness. See ../SKILL.md.
set -euo pipefail

ROOT="$(git -C "${BASH_SOURCE%/*}" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z ${ROOT} ]]; then
	echo "Run from a git checkout of vertexai-proxy" >&2
	exit 2
fi

RUN_ID="${RUN_ID:-$(date +%s)-$$}"
VERIFY_DIR="${VERIFY_DIR:-/tmp/vertexai-proxy-verify-${RUN_ID}}"
STATE_DIR="${VERIFY_DIR}/state"
EVIDENCE_DIR="${VERIFY_DIR}/evidence"
PROXY_PORT="${PROXY_VERIFY_PORT:-18765}"
PROXY_PID_FILE="${STATE_DIR}/proxy.pid"
PROXY_LOG="${STATE_DIR}/proxy.log"
API_KEY_FILE="${STATE_DIR}/api-key.txt"
META_FILE="${EVIDENCE_DIR}/run.json"

usage() {
	cat <<'EOF'
Usage: verify.sh <command>

Commands:
  doctor     Read-only checks (build, port, optional ADC)
  launch     Build, start proxy on PROXY_VERIFY_PORT (default 18765)
  drive      Run mapped HTTP checks; writes evidence under VERIFY_DIR/evidence
  cleanup    Stop proxy started by this RUN_ID and remove state (keeps evidence)
  all        doctor, launch, drive, cleanup (evidence retained)

Environment:
  RUN_ID                 Isolate this run (default: timestamp-pid)
  VERIFY_DIR             /tmp/vertexai-proxy-verify-$RUN_ID
  PROXY_VERIFY_PORT      Listen port (default 18765)
  GOOGLE_CLOUD_PROJECT   Required for chat completion proof
  VERTEX_LOCATION        Default global
  VERIFY_MODEL           Chat model (default gemini-3.8-flash)
  VERTEX_MODELS          Restrict model map (optional)
EOF
}

mkdir_state() {
	mkdir -p "${STATE_DIR}" "${EVIDENCE_DIR}"
	chmod 700 "${VERIFY_DIR}" "${STATE_DIR}" 2>/dev/null || true
}

write_meta() {
	node -e "
const fs = require('fs');
const meta = {
  runId: process.env.RUN_ID,
  verifyDir: process.env.VERIFY_DIR,
  evidenceDir: process.env.EVIDENCE_DIR,
  port: Number(process.env.PROXY_VERIFY_PORT),
  project: process.env.GOOGLE_CLOUD_PROJECT || null,
  location: process.env.VERTEX_LOCATION || 'global',
  finishedAt: new Date().toISOString(),
};
fs.writeFileSync(process.env.META_FILE, JSON.stringify(meta, null, 2) + '\n');
"
}

cmd_doctor() {
	mkdir_state
	local ok=0
	if [[ ! -f ${ROOT}/packages/proxy/dist/server.js ]]; then
		echo "FAIL build: packages/proxy/dist/server.js missing (run launch or pnpm build)"
		ok=1
	else
		echo "PASS build: dist/server.js present"
	fi
	if lsof -nP -iTCP:"${PROXY_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
		if [[ -f ${PROXY_PID_FILE} ]] && kill -0 "$(cat "${PROXY_PID_FILE}")" 2>/dev/null; then
			echo "PASS port: ${PROXY_PORT} owned by verify PID $(cat "${PROXY_PID_FILE}")"
		else
			echo "FAIL port: ${PROXY_PORT} in use by another process"
			ok=1
		fi
	else
		echo "PASS port: ${PROXY_PORT} free"
	fi
	if [[ -n ${GOOGLE_CLOUD_PROJECT-} ]]; then
		echo "PASS env: GOOGLE_CLOUD_PROJECT=${GOOGLE_CLOUD_PROJECT}"
	else
		echo "WARN env: GOOGLE_CLOUD_PROJECT unset (chat completion check will skip)"
	fi
	if gcloud auth application-default print-access-token >/dev/null 2>&1; then
		echo "PASS adc: application default credentials available"
	else
		echo "WARN adc: no ADC (chat completion check will skip)"
	fi
	return "${ok}"
}

cmd_launch() {
	mkdir_state
	cmd_doctor || true
	if lsof -nP -iTCP:"${PROXY_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
		if [[ -f ${PROXY_PID_FILE} ]] && kill -0 "$(cat "${PROXY_PID_FILE}")" 2>/dev/null; then
			echo "Proxy already running for this RUN_ID on port ${PROXY_PORT}"
			return 0
		fi
		echo "Port ${PROXY_PORT} is in use" >&2
		exit 3
	fi
	echo "Building proxy"
	pnpm --filter @vertexai-proxy/server build >/dev/null
	echo "Starting proxy on 127.0.0.1:${PROXY_PORT}"
	: >"${PROXY_LOG}"
	(
		cd "${ROOT}"
		GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-verify-project}" \
			VERTEX_LOCATION="${VERTEX_LOCATION:-global}" \
			PROXY_PORT="${PROXY_PORT}" \
			PROXY_STATE_FILE="${STATE_DIR}/proxy-state.json" \
			PROXY_LOG_FILE="${PROXY_LOG}" \
			PROXY_LOG_LEVEL="${PROXY_LOG_LEVEL:-info}" \
			VERTEX_MODELS="${VERTEX_MODELS-}" \
			node packages/proxy/dist/server.js
	) &
	echo $! >"${PROXY_PID_FILE}"
	for ((i = 0; i < 200; i++)); do
		if grep -q 'vertexai-proxy listening on ' "${PROXY_LOG}"; then
			sed -n 's/^vertexai-proxy API key: //p' "${PROXY_LOG}" | tail -1 >"${API_KEY_FILE}"
			if [[ -s ${API_KEY_FILE} ]]; then
				chmod 600 "${API_KEY_FILE}"
				echo "Ready: http://127.0.0.1:${PROXY_PORT}"
				return 0
			fi
		fi
		if ! kill -0 "$(cat "${PROXY_PID_FILE}")" 2>/dev/null; then
			echo "Proxy exited during startup" >&2
			tail -20 "${PROXY_LOG}" >&2 || true
			exit 4
		fi
		sleep 0.1
	done
	echo "Proxy not ready within 20s" >&2
	exit 4
}

api_key() {
	if [[ ! -s ${API_KEY_FILE} ]]; then
		sed -n 's/^vertexai-proxy API key: //p' "${PROXY_LOG}" | tail -1 >"${API_KEY_FILE}"
	fi
	cat "${API_KEY_FILE}"
}

save_http() {
	local name=$1
	shift
	curl -sS -m 30 -w $'\n---HTTP_CODE:%{http_code}---\n' "$@" >"${EVIDENCE_DIR}/${name}.txt" 2>&1 || true
}

cmd_drive() {
	mkdir_state
	if ! lsof -nP -iTCP:"${PROXY_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
		echo "Proxy not listening on ${PROXY_PORT}; run launch first" >&2
		exit 5
	fi
	local key failures=0
	key="$(api_key)"
	local base="http://127.0.0.1:${PROXY_PORT}"

	save_http healthz "${base}/healthz"
	if ! grep -Fq 'HTTP_CODE:200' "${EVIDENCE_DIR}/healthz.txt"; then
		echo "FAIL healthz"
		failures=$((failures + 1))
	else
		echo "PASS healthz"
	fi

	save_http models-unauth "${base}/v1/models"
	if ! grep -Fq 'HTTP_CODE:401' "${EVIDENCE_DIR}/models-unauth.txt"; then
		echo "FAIL models without bearer"
		failures=$((failures + 1))
	else
		echo "PASS models 401 without key"
	fi

	save_http models-auth "${base}/v1/models" -H "Authorization: Bearer ${key}"
	if ! grep -Fq 'HTTP_CODE:200' "${EVIDENCE_DIR}/models-auth.txt"; then
		echo "FAIL models with bearer"
		failures=$((failures + 1))
	else
		echo "PASS models 200 with key"
	fi
	if ! grep -q 'vertex-ai' "${EVIDENCE_DIR}/models-auth.txt"; then
		echo "FAIL models body missing vertex-ai"
		failures=$((failures + 1))
	fi

	grep 'vertexai-proxy response GET /v1/models' "${PROXY_LOG}" | tail -1 >"${EVIDENCE_DIR}/access-models.log" || true
	if [[ -s ${EVIDENCE_DIR}/access-models.log ]]; then
		if grep -q 'vertex_project=' "${EVIDENCE_DIR}/access-models.log" && grep -q 'model_count=' "${EVIDENCE_DIR}/access-models.log"; then
			echo "PASS access log metadata for models"
		else
			echo "FAIL access log missing vertex metadata"
			failures=$((failures + 1))
		fi
	else
		echo "WARN access log line for models not found"
	fi

	if [[ -n ${GOOGLE_CLOUD_PROJECT-} ]] && gcloud auth application-default print-access-token >/dev/null 2>&1; then
		local model="${VERIFY_MODEL:-gemini-3.8-flash}"
		save_http chat "${base}/v1/chat/completions" \
			-H "Authorization: Bearer ${key}" \
			-H 'Content-Type: application/json' \
			-d "{\"model\":\"${model}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with one word: ok\"}]}"
		if ! grep -Fq 'HTTP_CODE:200' "${EVIDENCE_DIR}/chat.txt"; then
			echo "FAIL chat completions HTTP"
			failures=$((failures + 1))
		else
			echo "PASS chat completions HTTP 200"
		fi
		if ! node -e "
const fs = require('fs');
const raw = fs.readFileSync('${EVIDENCE_DIR}/chat.txt', 'utf8');
const body = raw.split(/---HTTP_CODE:/)[0];
const v = JSON.parse(body);
if (!v.choices?.[0]?.message?.content) process.exit(1);
" 2>/dev/null; then
			echo "FAIL chat completions empty content"
			failures=$((failures + 1))
		else
			echo "PASS chat completions content"
		fi
		grep 'vertexai-proxy response POST /v1/chat/completions' "${PROXY_LOG}" | tail -1 >"${EVIDENCE_DIR}/access-chat.log" || true
		if [[ -s ${EVIDENCE_DIR}/access-chat.log ]] && grep -q 'vertex_upstream_status=200' "${EVIDENCE_DIR}/access-chat.log"; then
			echo "PASS access log vertex_upstream_status=200"
		else
			echo "FAIL access log missing vertex_upstream_status=200"
			failures=$((failures + 1))
		fi
	else
		echo "SKIP chat completions (set GOOGLE_CLOUD_PROJECT and ADC)"
		echo "skip: chat" >"${EVIDENCE_DIR}/chat-skipped.txt"
	fi

	export RUN_ID VERIFY_DIR EVIDENCE_DIR PROXY_VERIFY_PORT="${PROXY_PORT}"
	export GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT-}"
	export VERTEX_LOCATION="${VERTEX_LOCATION:-global}"
	write_meta

	if [[ ${failures} -ne 0 ]]; then
		echo "${failures} check(s) failed; evidence in ${EVIDENCE_DIR}" >&2
		exit 1
	fi
	echo "All driven checks passed; evidence in ${EVIDENCE_DIR}"
}

cmd_cleanup() {
	if [[ -f ${PROXY_PID_FILE} ]]; then
		local pid
		pid="$(cat "${PROXY_PID_FILE}")"
		if kill -0 "${pid}" 2>/dev/null; then
			kill "${pid}" 2>/dev/null || true
			wait "${pid}" 2>/dev/null || true
		fi
		rm -f "${PROXY_PID_FILE}"
	fi
	rm -rf "${STATE_DIR}"
	echo "State removed; evidence kept at ${EVIDENCE_DIR}"
}

main() {
	export RUN_ID VERIFY_DIR STATE_DIR EVIDENCE_DIR PROXY_VERIFY_PORT="${PROXY_PORT}"
	export META_FILE
	case "${1-}" in
	doctor) cmd_doctor ;;
	launch) cmd_launch ;;
	drive) cmd_drive ;;
	cleanup) cmd_cleanup ;;
	all)
		cmd_doctor
		cmd_launch
		cmd_drive
		cmd_cleanup
		;;
	-h | --help | help) usage ;;
	*)
		usage >&2
		exit 2
		;;
	esac
}

main "$@"
