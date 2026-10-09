#!/usr/bin/env python3
"""V16 OpenRouter reservation journal. No transport or key access occurs here."""
import fcntl
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

CAMPAIGN_CAP = 2_000_000
MONTH_CAP = 5_000_000
DAILY_CAP = 1_000_000
MODEL = 'openai/gpt-4.1-mini'
ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
TASK = 'ADHOC-2026-09-26-media-intelligence'
HEX = re.compile(r'^[0-9a-f]{64}$')
ID = re.compile(r'^[0-9a-f]{32}$')


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def owned(path, mode, directory=False):
    st = path.lstat()
    require(not path.is_symlink() and st.st_uid == os.getuid()
            and st.st_mode & 0o777 == mode and (directory or st.st_nlink == 1),
            'unsafe custody: ' + path.name)
    require(path.is_dir() if directory else path.is_file(), 'wrong file type: ' + path.name)
    return st


def read_json(path, digest=None):
    owned(path, 0o600)
    raw = path.read_bytes()
    require(len(raw) <= 16384, 'oversize sidecar')
    if digest is not None:
        require(bool(HEX.fullmatch(digest)) and hashlib.sha256(raw).hexdigest() == digest,
                'sidecar digest mismatch')
    obj = json.loads(raw)
    require(type(obj) is dict, 'sidecar must be object')
    return obj


def write_once(directory, name, value):
    raw = (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
    fd = os.open(directory / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb', closefd=False) as stream:
            stream.write(raw)
            stream.flush()
        os.fsync(fd)
    finally:
        os.close(fd)
    dirfd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(dirfd)
    finally:
        os.close(dirfd)
    require(read_json(directory / name) == value, 'event readback mismatch')


def whole(n, label, high=10**12):
    require(type(n) is int and 0 <= n <= high, 'invalid ' + label)
    return n


def iso(s):
    require(type(s) is str and s.endswith('Z'), 'invalid UTC timestamp')
    d = datetime.fromisoformat(s.replace('Z', '+00:00'))
    require(d.tzinfo == timezone.utc, 'timestamp is not UTC')
    return d


def load_events(root):
    result = {}
    for entry in root.iterdir():
        if entry.name in ('lock', 'profile.json', 'account.json', 'settlement-approval.json'):
            continue
        match = re.fullmatch(r'([0-9a-f]{32})\.(intent|unknown|settled)\.json', entry.name)
        require(match is not None, 'unknown ledger entry')
        obj = read_json(entry)
        require(obj.get('id') == match.group(1) and obj.get('state') == match.group(2),
                'event name/body mismatch')
        result.setdefault(match.group(1), {})[match.group(2)] = obj
    for events in result.values():
        require('intent' in events, 'invalid event sequence')
        intent = events['intent']
        created = iso(intent.get('created_utc'))
        require(intent.get('utc_day') == created.strftime('%Y-%m-%d')
                and intent.get('month_utc') == created.strftime('%Y-%m'),
                'invalid intent UTC day')
    return result


def check_profile(profile, account, call, now):
    require(profile.get('task') == TASK and profile.get('provider') == 'openrouter'
            and profile.get('model') == MODEL and profile.get('endpoint') == ENDPOINT,
            'wrong task/provider/model/endpoint')
    require(profile.get('approved') is True and profile.get('byok') is False
            and profile.get('price_basis') == 'FIRST_PARTY_REVIEWED'
            and bool(HEX.fullmatch(str(profile.get('price_basis_sha256', '')))),
            'price/activation review missing')
    require(profile.get('purpose') == call.get('purpose') and type(call.get('purpose')) is str
            and 1 <= len(call['purpose']) <= 80, 'unapproved purpose')
    require(profile.get('key_sha256') == call.get('key_sha256')
            and bool(HEX.fullmatch(str(call.get('key_sha256', '')))), 'wrong protected key')
    request_bytes = whole(call.get('request_bytes'), 'request bytes', 1_048_576)
    max_tokens = whole(call.get('max_tokens'), 'output token cap', 8192)
    require(request_bytes > 0 and max_tokens > 0
            and request_bytes <= whole(profile.get('max_request_bytes'), 'request cap', 1_048_576)
            and max_tokens <= whole(profile.get('max_output_tokens'), 'output cap', 8192),
            'request exceeds approved bound')
    input_cap = whole(profile.get('max_input_tokens'), 'input token bound', 2_000_000)
    require(input_cap >= profile['max_request_bytes'] + 1024, 'input token bound is not conservative')
    inp = whole(profile.get('input_price_micros_per_million'), 'input price')
    out = whole(profile.get('output_price_micros_per_million'), 'output price')
    require(inp > 0 and out > 0, 'missing price')
    worst = (input_cap * inp + profile['max_output_tokens'] * out + 999_999) // 1_000_000
    require(worst > 0 and worst == profile.get('worst_case_micros'), 'unbound worst case')
    require(profile.get('campaign_cap_micros') == CAMPAIGN_CAP
            and profile.get('key_month_cap_micros') == MONTH_CAP
            and type(profile.get('daily_cap_micros')) is int
            and profile['daily_cap_micros'] == DAILY_CAP,
            'wrong spend ceiling')
    require(account.get('task') == TASK and account.get('provider') == 'openrouter'
            and account.get('key_sha256') == profile['key_sha256']
            and account.get('byok') is False and account.get('readback_verified') is True,
            'account/key readback missing')
    used = whole(account.get('used_micros'), 'account used')
    remain = whole(account.get('remaining_micros'), 'account remaining')
    limit = whole(account.get('limit_micros'), 'account limit')
    baseline = whole(profile.get('campaign_baseline_micros'), 'monthly baseline')
    whole(profile.get('campaign_prior_spend_micros'), 'prior campaign spend')
    require(limit == MONTH_CAP and used + remain == limit and baseline <= used,
            'account numeric ceiling mismatch')
    readback = iso(account.get('readback_utc'))
    require(0 <= (now - readback).total_seconds() <= 900, 'stale or future account readback')
    require(account.get('month_utc') == now.strftime('%Y-%m')
            and profile.get('month_utc') == account['month_utc'], 'month mismatch')
    return worst, used, baseline


def transact(root, request):
    owned(root, 0o700, directory=True)
    lock = root / 'lock'
    owned(lock, 0o600)
    fd = os.open(lock, os.O_RDWR | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        require(os.fstat(fd).st_ino == lock.stat().st_ino, 'lock changed')
        events = load_events(root)
        action = request.get('action')
        call_id = request.get('id')
        require(type(call_id) is str and ID.fullmatch(call_id), 'invalid call id')
        if action == 'reserve':
            require(all(bool(HEX.fullmatch(str(request.get(k, ''))))
                        for k in ('profile_sha256', 'account_sha256')),
                    'missing pinned sidecar digests')
            require(call_id not in events, 'call id reused')
            require(not any('settled' not in v for v in events.values()), 'unresolved call holds ledger')
            profile = read_json(root / 'profile.json', request.get('profile_sha256'))
            account = read_json(root / 'account.json', request.get('account_sha256'))
            now = iso(request.get('now_utc'))
            worst, used, baseline = check_profile(profile, account, request, now)
            require(all(type(v['settled'].get('charge_micros')) is int
                        and 0 <= v['settled']['charge_micros'] <= v['intent']['worst_case_micros']
                        for v in events.values()), 'invalid settlement')
            settled = sum(v['settled']['charge_micros'] for v in events.values())
            month_settled = sum(v['settled']['charge_micros'] for v in events.values()
                                if v['intent']['month_utc'] == account['month_utc'])
            utc_day = now.strftime('%Y-%m-%d')
            day_settled = sum(v['settled']['charge_micros'] for v in events.values()
                              if v['intent']['utc_day'] == utc_day)
            require(used == baseline + month_settled, 'first-party spend differs from ledger')
            require(profile['campaign_prior_spend_micros'] + settled + worst <= CAMPAIGN_CAP
                    and used + worst <= MONTH_CAP and day_settled + worst <= DAILY_CAP,
                    'campaign, month or UTC day ceiling exceeded')
            intent = {'id': call_id, 'state': 'intent', 'task': TASK,
                      'month_utc': account['month_utc'], 'utc_day': utc_day,
                      'purpose': request['purpose'],
                      'key_sha256': request['key_sha256'], 'worst_case_micros': worst,
                      'account_used_micros': used, 'profile_sha256': request['profile_sha256'],
                      'account_sha256': request['account_sha256'], 'created_utc': request['now_utc'],
                      'profile_before': profile, 'account_before': account}
            write_once(root, call_id + '.intent.json', intent)
            return {'status': 'RESERVED', 'id': call_id, 'worst_case_micros': worst}
        require(call_id in events, 'unknown call')
        entry = events[call_id]
        require('settled' not in entry, 'already settled')
        if action == 'unknown':
            require('unknown' not in entry, 'already unknown')
            write_once(root, call_id + '.unknown.json',
                       {'id': call_id, 'state': 'unknown', 'reason': 'TRANSPORT_OUTCOME_UNPROVEN'})
            return {'status': 'RECONCILIATION_HOLD', 'id': call_id}
        if action == 'settle':
            require(all(bool(HEX.fullmatch(str(request.get(k, ''))))
                        for k in ('settlement_approval_sha256', 'account_sha256')),
                    'missing pinned settlement digests')
            approval = read_json(root / 'settlement-approval.json',
                                 request.get('settlement_approval_sha256'))
            require(approval.get('task') == TASK and approval.get('call_id') == call_id
                    and approval.get('isolated_first_party_delta_approved') is True
                    and approval.get('account_sha256') == request.get('account_sha256')
                    and approval.get('charge_micros') == request.get('charge_micros'),
                    'isolated first-party delta not approved')
            after = read_json(root / 'account.json', request.get('account_sha256'))
            before = entry['intent']['account_used_micros']
            charge = whole(request.get('charge_micros'), 'charge')
            require(after.get('key_sha256') == entry['intent']['key_sha256']
                    and after.get('byok') is False and after.get('readback_verified') is True
                    and after.get('month_utc') == entry['intent']['month_utc']
                    and after.get('used_micros') == before + charge
                    and after.get('limit_micros') == MONTH_CAP
                    and after.get('remaining_micros') == MONTH_CAP - before - charge
                    and iso(after.get('readback_utc')) > iso(entry['intent']['created_utc'])
                    and charge <= entry['intent']['worst_case_micros'],
                    'first-party delta unresolved')
            write_once(root, call_id + '.settled.json',
                       {'id': call_id, 'state': 'settled', 'charge_micros': charge,
                        'account_sha256': request['account_sha256']})
            return {'status': 'SETTLED', 'id': call_id, 'charge_micros': charge}
        raise ValueError('unknown ledger action')
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


if __name__ == '__main__':
    try:
        payload = json.load(sys.stdin)
        require(type(payload) is dict and type(payload.get('root')) is str, 'invalid request')
        result = transact(Path(payload['root']), payload)
        print(json.dumps(result, sort_keys=True))
    except Exception as exc:
        print(json.dumps({'status': 'HOLD', 'reason': str(exc)}))
        sys.exit(2)
