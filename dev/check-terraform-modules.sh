#!/usr/bin/env bash
set -u

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0

forbidden="$(
	grep -R -E -n --include='*.tf' \
		-e 'resource[[:space:]]+"google_service_account"' \
		-e 'resource[[:space:]]+"google_project_service"' \
		-e 'iam_binding' \
		-e 'iam_policy' \
		"${repo_root}/infra" || true
)"
if [[ -n ${forbidden} ]]; then
	printf '%s\n' "${forbidden}" >&2
	fail=1
fi

providers="$(
	grep -R -E -n --include='*.tf' 'provider[[:space:]]+"google"' \
		"${repo_root}/infra/modules" || true
)"
if [[ -n ${providers} ]]; then
	printf '%s\n' "${providers}" >&2
	fail=1
fi

if ! grep -R -q --include='*.tf' 'impersonate_service_account' "${repo_root}/infra"; then
	echo 'infra is missing impersonate_service_account' >&2
	fail=1
fi

if ! grep -R -q --include='*.tf' 'IMPERSONATE_SERVICE_ACCOUNT' "${repo_root}/infra/modules"; then
	echo 'module is missing IMPERSONATE_SERVICE_ACCOUNT' >&2
	fail=1
fi

if ! grep -R -q --include='*.tf' 'projects/.*/serviceAccounts/' "${repo_root}/infra/modules"; then
	echo 'token creator service_account_id must be projects/PROJECT/serviceAccounts/EMAIL' >&2
	fail=1
fi

exit "${fail}"
